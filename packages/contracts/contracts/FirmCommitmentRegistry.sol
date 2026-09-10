// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";

import { BondVault } from "./BondVault.sol";
import { FirmPricing } from "./libraries/FirmPricing.sol";
import { AcceptanceSnapshot, Commitment, CommitmentStatus, FirmQuote } from "./types/FirmTypes.sol";

interface IFirmAcceptanceValidator {
    function validateAcceptance(FirmQuote calldata quote, ISwapVM.Order calldata order)
        external
        view
        returns (AcceptanceSnapshot memory snapshot);
}

contract FirmCommitmentRegistry is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant FIRM_QUOTE_TYPEHASH = keccak256(
        "FirmQuote(address maker,address taker,address executor,address swapRouter,bytes32 orderHash,address tokenIn,address tokenOut,uint256 amountIn,uint256 referenceAmountOut,uint256 minAmountOut,uint256 requiredBond,address premiumToken,uint256 premiumAmount,uint32 pricingVersion,uint256 sigmaWad,uint256 annualCapitalRateWad,uint16 capacityKBps,uint256 utilizationAfterWad,uint256 minPremiumOut,uint64 expiry,uint256 nonce)"
    );

    error Unauthorized();
    error ZeroAddress();
    error ExecutorAlreadySet();
    error ExecutorNotSet();
    error WrongTaker(address expected, address actual);
    error WrongExecutor(address expected, address actual);
    error UnsupportedPair(address tokenIn, address tokenOut);
    error InvalidAmount();
    error InsufficientRequiredBond(uint256 requiredBond, uint256 minAmountOut);
    error QuoteExpired(uint64 expiry);
    error ExpiryTooLarge(uint64 expiry);
    error QuoteTtlTooLong(uint64 expiry, uint64 maximumExpiry);
    error InvalidQuoteTtl(uint64 maxQuoteTtl);
    error UnsupportedPricingVersion(uint32 pricingVersion);
    error UnsupportedPremiumToken(address expected, address actual);
    error PremiumMismatch(uint256 expected, uint256 actual);
    error UtilizationMismatch(uint256 expected, uint256 actual);
    error NonceAlreadyUsed(address maker, uint256 nonce);
    error NonceBelowMinimum(address maker, uint256 nonce, uint256 minimum);
    error NonceFloorNotIncreasing(uint256 current, uint256 requested);
    error InvalidMakerSignature(address maker);
    error CommitmentAlreadyExists(bytes32 commitmentId);
    error CommitmentNotAccepted(bytes32 commitmentId, CommitmentStatus status);
    error CommitmentNotExpired(bytes32 commitmentId, uint64 expiry);
    error DeflationaryTokenUnsupported();

    BondVault public immutable vault;
    IERC20 public immutable premiumToken;
    address public immutable tokenIn;
    address public immutable tokenOut;
    address public immutable owner;
    uint64 public immutable maxQuoteTtl;
    address public executor;

    mapping(bytes32 commitmentId => Commitment) private _commitments;
    mapping(address maker => mapping(uint256 nonce => bool used)) public nonceUsed;
    mapping(address maker => uint256) public minimumValidNonce;

    event ExecutorSet(address indexed executor);
    event NonceCancelled(address indexed maker, uint256 indexed nonce);
    event NonceFloorRaised(address indexed maker, uint256 previousMinimum, uint256 newMinimum);
    event CommitmentAccepted(
        bytes32 indexed commitmentId,
        address indexed maker,
        address indexed taker,
        bytes32 orderHash,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 premiumAmount,
        uint64 expiry,
        uint256 nonce,
        uint64 acceptedBlock,
        uint256 virtualBalance,
        uint256 realBalance,
        uint256 aquaAllowance,
        uint256 effectiveCapacity,
        uint256 quotedAmountOut,
        uint256 utilizationAfterWad
    );
    event CommitmentSettled(bytes32 indexed commitmentId, CommitmentStatus indexed status, address indexed beneficiary);

    constructor(
        address vault_,
        address tokenIn_,
        address tokenOut_,
        address owner_,
        uint64 maxQuoteTtl_
    )
        EIP712("FirmDepth", "1")
    {
        if (vault_ == address(0) || tokenIn_ == address(0) || tokenOut_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }
        if (maxQuoteTtl_ == 0 || maxQuoteTtl_ > FirmPricing.MAX_TTL) revert InvalidQuoteTtl(maxQuoteTtl_);
        vault = BondVault(vault_);
        premiumToken = IERC20(tokenIn_);
        tokenIn = tokenIn_;
        tokenOut = tokenOut_;
        owner = owner_;
        maxQuoteTtl = maxQuoteTtl_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert Unauthorized();
        _;
    }

    function setExecutor(address executor_) external onlyOwner {
        if (executor != address(0)) revert ExecutorAlreadySet();
        if (executor_ == address(0)) revert ZeroAddress();
        executor = executor_;
        emit ExecutorSet(executor_);
    }

    function accept(FirmQuote calldata quote, ISwapVM.Order calldata order, bytes calldata makerSignature)
        external
        nonReentrant
        returns (bytes32 commitmentId)
    {
        if (executor == address(0)) revert ExecutorNotSet();
        if (msg.sender != quote.taker) revert WrongTaker(quote.taker, msg.sender);
        if (quote.executor != executor) revert WrongExecutor(executor, quote.executor);
        if (quote.tokenIn != tokenIn || quote.tokenOut != tokenOut) {
            revert UnsupportedPair(quote.tokenIn, quote.tokenOut);
        }
        if (
            quote.maker == address(0)
                || quote.taker == address(0)
                || quote.swapRouter == address(0)
                || quote.premiumToken == address(0)
                || quote.orderHash == bytes32(0)
        ) revert ZeroAddress();
        if (quote.amountIn == 0 || quote.referenceAmountOut == 0 || quote.minAmountOut == 0) revert InvalidAmount();
        if (quote.requiredBond < quote.minAmountOut) {
            revert InsufficientRequiredBond(quote.requiredBond, quote.minAmountOut);
        }
        if (quote.expiry <= block.timestamp) revert QuoteExpired(quote.expiry);
        if (quote.expiry > type(uint40).max) revert ExpiryTooLarge(quote.expiry);
        uint64 maximumExpiry = uint64(block.timestamp) + maxQuoteTtl;
        if (quote.expiry > maximumExpiry) revert QuoteTtlTooLong(quote.expiry, maximumExpiry);
        if (quote.pricingVersion != FirmPricing.PRICING_VERSION) {
            revert UnsupportedPricingVersion(quote.pricingVersion);
        }
        if (quote.premiumToken != address(premiumToken)) {
            revert UnsupportedPremiumToken(address(premiumToken), quote.premiumToken);
        }
        uint256 nonceFloor = minimumValidNonce[quote.maker];
        if (quote.nonce < nonceFloor) revert NonceBelowMinimum(quote.maker, quote.nonce, nonceFloor);
        if (nonceUsed[quote.maker][quote.nonce]) revert NonceAlreadyUsed(quote.maker, quote.nonce);
        uint256 expectedUtilization = utilizationAfter(quote.maker, quote.requiredBond);
        if (quote.utilizationAfterWad != expectedUtilization) {
            revert UtilizationMismatch(expectedUtilization, quote.utilizationAfterWad);
        }
        FirmPricing.Result memory pricing = FirmPricing.quote(_pricingInputs(quote));
        if (quote.premiumAmount != pricing.premiumIn) {
            revert PremiumMismatch(pricing.premiumIn, quote.premiumAmount);
        }
        commitmentId = quoteDigest(quote);
        if (_commitments[commitmentId].status != CommitmentStatus.NONE) revert CommitmentAlreadyExists(commitmentId);
        if (!SignatureChecker.isValidSignatureNow(quote.maker, commitmentId, makerSignature)) {
            revert InvalidMakerSignature(quote.maker);
        }

        AcceptanceSnapshot memory snapshot = IFirmAcceptanceValidator(executor).validateAcceptance(quote, order);

        nonceUsed[quote.maker][quote.nonce] = true;
        _commitments[commitmentId] = Commitment({
            quote: quote,
            status: CommitmentStatus.ACCEPTED,
            acceptedAt: uint64(block.timestamp),
            settledAt: 0,
            acceptedBlock: uint64(block.number)
        });

        vault.lock(commitmentId, quote.maker, quote.requiredBond);
        if (quote.premiumAmount != 0) {
            uint256 beforeBalance = premiumToken.balanceOf(address(this));
            premiumToken.safeTransferFrom(quote.taker, address(this), quote.premiumAmount);
            if (premiumToken.balanceOf(address(this)) - beforeBalance != quote.premiumAmount) {
                revert DeflationaryTokenUnsupported();
            }
        }

        emit CommitmentAccepted(
            commitmentId,
            quote.maker,
            quote.taker,
            quote.orderHash,
            quote.amountIn,
            quote.minAmountOut,
            quote.premiumAmount,
            quote.expiry,
            quote.nonce,
            uint64(block.number),
            snapshot.virtualBalance,
            snapshot.realBalance,
            snapshot.aquaAllowance,
            snapshot.effectiveCapacity,
            snapshot.quotedAmountOut,
            quote.utilizationAfterWad
        );
    }

    function finalizeAqua(bytes32 commitmentId) external onlyExecutor nonReentrant {
        Commitment storage commitment = _accepted(commitmentId);
        if (block.timestamp > commitment.quote.expiry) revert QuoteExpired(commitment.quote.expiry);
        commitment.status = CommitmentStatus.FILLED_AQUA;
        commitment.settledAt = uint64(block.timestamp);

        vault.unlock(commitmentId);
        _payPremium(commitment.quote.maker, commitment.quote.premiumAmount);
        emit CommitmentSettled(commitmentId, CommitmentStatus.FILLED_AQUA, commitment.quote.maker);
    }

    function finalizeBond(bytes32 commitmentId) external onlyExecutor nonReentrant {
        Commitment storage commitment = _accepted(commitmentId);
        if (block.timestamp > commitment.quote.expiry) revert QuoteExpired(commitment.quote.expiry);
        commitment.status = CommitmentStatus.FILLED_BOND;
        commitment.settledAt = uint64(block.timestamp);

        vault.release(commitmentId, commitment.quote.taker, commitment.quote.minAmountOut);
        _payPremium(commitment.quote.taker, commitment.quote.premiumAmount);
        emit CommitmentSettled(commitmentId, CommitmentStatus.FILLED_BOND, commitment.quote.taker);
    }

    function expire(bytes32 commitmentId) external nonReentrant {
        Commitment storage commitment = _accepted(commitmentId);
        if (block.timestamp <= commitment.quote.expiry) {
            revert CommitmentNotExpired(commitmentId, commitment.quote.expiry);
        }
        commitment.status = CommitmentStatus.EXPIRED;
        commitment.settledAt = uint64(block.timestamp);

        vault.unlock(commitmentId);
        _payPremium(commitment.quote.maker, commitment.quote.premiumAmount);
        emit CommitmentSettled(commitmentId, CommitmentStatus.EXPIRED, commitment.quote.maker);
    }

    function cancelNonce(uint256 nonce) external {
        nonceUsed[msg.sender][nonce] = true;
        emit NonceCancelled(msg.sender, nonce);
    }

    function raiseMinimumValidNonce(uint256 newMinimum) external {
        uint256 current = minimumValidNonce[msg.sender];
        if (newMinimum <= current) revert NonceFloorNotIncreasing(current, newMinimum);
        minimumValidNonce[msg.sender] = newMinimum;
        emit NonceFloorRaised(msg.sender, current, newMinimum);
    }

    function quoteDigest(FirmQuote calldata quote) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            FIRM_QUOTE_TYPEHASH,
            quote.maker,
            quote.taker,
            quote.executor,
            quote.swapRouter,
            quote.orderHash,
            quote.tokenIn,
            quote.tokenOut,
            quote.amountIn,
            quote.referenceAmountOut,
            quote.minAmountOut,
            quote.requiredBond,
            quote.premiumToken,
            quote.premiumAmount,
            quote.pricingVersion,
            quote.sigmaWad,
            quote.annualCapitalRateWad,
            quote.capacityKBps,
            quote.utilizationAfterWad,
            quote.minPremiumOut,
            quote.expiry,
            quote.nonce
        )));
    }

    function getCommitment(bytes32 commitmentId) external view returns (Commitment memory) {
        return _commitments[commitmentId];
    }

    function utilizationAfter(address maker, uint256 requiredBond) public view returns (uint256) {
        uint256 available = vault.availableOf(maker);
        uint256 locked = vault.lockedOf(maker);
        uint256 total = available + locked;
        if (total == 0 || requiredBond > available) return FirmPricing.WAD;
        return Math.mulDiv(locked + requiredBond, FirmPricing.WAD, total);
    }

    function quotePremium(FirmQuote calldata quote) external view returns (FirmPricing.Result memory) {
        return FirmPricing.quote(_pricingInputs(quote));
    }

    function _payPremium(address recipient, uint256 amount) private {
        if (amount == 0) return;
        uint256 registryBefore = premiumToken.balanceOf(address(this));
        uint256 recipientBefore = premiumToken.balanceOf(recipient);
        premiumToken.safeTransfer(recipient, amount);
        uint256 registryAfter = premiumToken.balanceOf(address(this));
        uint256 recipientAfter = premiumToken.balanceOf(recipient);
        if (
            registryAfter > registryBefore
                || registryBefore - registryAfter != amount
                || recipientAfter < recipientBefore
                || recipientAfter - recipientBefore != amount
        ) revert DeflationaryTokenUnsupported();
    }

    function _accepted(bytes32 commitmentId) private view returns (Commitment storage commitment) {
        commitment = _commitments[commitmentId];
        if (commitment.status != CommitmentStatus.ACCEPTED) {
            revert CommitmentNotAccepted(commitmentId, commitment.status);
        }
    }

    function _pricingInputs(FirmQuote calldata quote) private view returns (FirmPricing.Inputs memory) {
        uint256 ttl = quote.expiry > block.timestamp ? quote.expiry - block.timestamp : 0;
        return FirmPricing.Inputs({
            amountIn: quote.amountIn,
            referenceAmountOut: quote.referenceAmountOut,
            minAmountOut: quote.minAmountOut,
            requiredBond: quote.requiredBond,
            sigmaWad: quote.sigmaWad,
            annualCapitalRateWad: quote.annualCapitalRateWad,
            capacityKBps: quote.capacityKBps,
            utilizationAfterWad: quote.utilizationAfterWad,
            minPremiumOut: quote.minPremiumOut,
            ttl: ttl
        });
    }
}

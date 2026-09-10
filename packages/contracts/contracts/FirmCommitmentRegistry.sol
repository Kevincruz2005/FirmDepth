// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { BondVault } from "./BondVault.sol";
import { Commitment, CommitmentStatus, FirmQuote } from "./types/FirmTypes.sol";

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
    error BondMustEqualMinOut(uint256 bond, uint256 minOut);
    error QuoteExpired(uint64 expiry);
    error ExpiryTooLarge(uint64 expiry);
    error QuoteTtlTooLong(uint64 expiry, uint64 maximumExpiry);
    error InvalidPremiumPolicy(uint16 minimumBps, uint16 maximumBps, uint64 maxQuoteTtl);
    error PremiumOutOfRange(uint256 premium, uint256 minimum, uint256 maximum);
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
    uint16 public immutable minimumPremiumBps;
    uint16 public immutable maximumPremiumBps;
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
        uint256 nonce
    );
    event CommitmentSettled(bytes32 indexed commitmentId, CommitmentStatus indexed status, address indexed beneficiary);

    constructor(
        address vault_,
        address tokenIn_,
        address tokenOut_,
        address owner_,
        uint16 minimumPremiumBps_,
        uint16 maximumPremiumBps_,
        uint64 maxQuoteTtl_
    )
        EIP712("FirmDepth", "1")
    {
        if (vault_ == address(0) || tokenIn_ == address(0) || tokenOut_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }
        if (maximumPremiumBps_ > 10_000 || minimumPremiumBps_ > maximumPremiumBps_ || maxQuoteTtl_ == 0) {
            revert InvalidPremiumPolicy(minimumPremiumBps_, maximumPremiumBps_, maxQuoteTtl_);
        }
        vault = BondVault(vault_);
        premiumToken = IERC20(tokenOut_);
        tokenIn = tokenIn_;
        tokenOut = tokenOut_;
        owner = owner_;
        minimumPremiumBps = minimumPremiumBps_;
        maximumPremiumBps = maximumPremiumBps_;
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

    function accept(FirmQuote calldata quote, bytes calldata makerSignature)
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
        if (quote.requiredBond != quote.minAmountOut) {
            revert BondMustEqualMinOut(quote.requiredBond, quote.minAmountOut);
        }
        if (quote.expiry <= block.timestamp) revert QuoteExpired(quote.expiry);
        if (quote.expiry > type(uint40).max) revert ExpiryTooLarge(quote.expiry);
        uint64 maximumExpiry = uint64(block.timestamp) + maxQuoteTtl;
        if (quote.expiry > maximumExpiry) revert QuoteTtlTooLong(quote.expiry, maximumExpiry);
        (uint256 minimumPremium, uint256 maximumPremium) = premiumBounds(quote.minAmountOut);
        if (quote.premiumAmount < minimumPremium || quote.premiumAmount > maximumPremium) {
            revert PremiumOutOfRange(quote.premiumAmount, minimumPremium, maximumPremium);
        }
        uint256 nonceFloor = minimumValidNonce[quote.maker];
        if (quote.nonce < nonceFloor) revert NonceBelowMinimum(quote.maker, quote.nonce, nonceFloor);
        if (nonceUsed[quote.maker][quote.nonce]) revert NonceAlreadyUsed(quote.maker, quote.nonce);

        commitmentId = quoteDigest(quote);
        if (_commitments[commitmentId].status != CommitmentStatus.NONE) revert CommitmentAlreadyExists(commitmentId);
        if (!SignatureChecker.isValidSignatureNow(quote.maker, commitmentId, makerSignature)) {
            revert InvalidMakerSignature(quote.maker);
        }

        nonceUsed[quote.maker][quote.nonce] = true;
        _commitments[commitmentId] = Commitment({
            quote: quote,
            status: CommitmentStatus.ACCEPTED,
            acceptedAt: uint64(block.timestamp),
            settledAt: 0
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
            quote.nonce
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

        vault.release(commitmentId, commitment.quote.taker);
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

    function premiumBounds(uint256 minOut) public view returns (uint256 minimum, uint256 maximum) {
        minimum = Math.mulDiv(minOut, minimumPremiumBps, 10_000, Math.Rounding.Ceil);
        maximum = Math.mulDiv(minOut, maximumPremiumBps, 10_000);
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
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { FirmAquaSwapVMRouter } from "./FirmAquaSwapVMRouter.sol";
import { Commitment, CommitmentStatus, FirmQuote, IFirmCommitmentRegistry } from "./types/FirmTypes.sol";

contract FirmExecutor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Capacity {
        uint256 virtualBalance;
        uint256 realBalance;
        uint256 aquaAllowance;
        uint256 effectiveCapacity;
        bool strategyActive;
    }

    error UnauthorizedTrader(address expected, address actual);
    error CommitmentNotAccepted(bytes32 commitmentId, CommitmentStatus status);
    error CommitmentExpired(uint64 expiry);
    error OrderHashMismatch(bytes32 expected, bytes32 actual);
    error QuoteResultMismatch();
    error SwapResultMismatch();
    error DeflationaryTokenUnsupported();

    IFirmCommitmentRegistry public immutable registry;
    IAqua public immutable aqua;
    FirmAquaSwapVMRouter public immutable router;

    event PathSelected(
        bytes32 indexed commitmentId,
        bool indexed aquaPath,
        uint256 virtualBalance,
        uint256 realBalance,
        uint256 aquaAllowance,
        uint256 effectiveCapacity,
        uint256 requiredOutput
    );
    event FirmTradeExecuted(
        bytes32 indexed commitmentId,
        CommitmentStatus indexed status,
        address indexed trader,
        address maker,
        uint256 amountIn,
        uint256 amountOut
    );

    constructor(address registry_, address aqua_, address router_) {
        registry = IFirmCommitmentRegistry(registry_);
        aqua = IAqua(aqua_);
        router = FirmAquaSwapVMRouter(payable(router_));
    }

    function execute(bytes32 commitmentId, ISwapVM.Order calldata order)
        external
        nonReentrant
        returns (CommitmentStatus terminalStatus, uint256 amountOut)
    {
        Commitment memory commitment = registry.getCommitment(commitmentId);
        FirmQuote memory quote = commitment.quote;
        if (commitment.status != CommitmentStatus.ACCEPTED) {
            revert CommitmentNotAccepted(commitmentId, commitment.status);
        }
        if (msg.sender != quote.trader) revert UnauthorizedTrader(quote.trader, msg.sender);
        if (block.timestamp > quote.expiry) revert CommitmentExpired(quote.expiry);

        bytes32 actualOrderHash = router.hash(order);
        if (actualOrderHash != quote.orderHash) revert OrderHashMismatch(quote.orderHash, actualOrderHash);

        Capacity memory available = _capacity(quote);
        bool useAqua = available.strategyActive && available.effectiveCapacity >= quote.minOut;
        emit PathSelected(
            commitmentId,
            useAqua,
            available.virtualBalance,
            available.realBalance,
            available.aquaAllowance,
            available.effectiveCapacity,
            quote.minOut
        );

        if (useAqua) {
            amountOut = _executeAqua(commitmentId, quote, order);
            terminalStatus = CommitmentStatus.FILLED_AQUA;
            registry.finalizeAqua(commitmentId);
        } else {
            _pullExact(IERC20(quote.tokenIn), quote.trader, quote.amountIn);
            IERC20(quote.tokenIn).safeTransfer(quote.maker, quote.amountIn);
            amountOut = quote.minOut;
            terminalStatus = CommitmentStatus.FILLED_BOND;
            registry.finalizeBond(commitmentId);
        }

        emit FirmTradeExecuted(
            commitmentId,
            terminalStatus,
            quote.trader,
            quote.maker,
            quote.amountIn,
            amountOut
        );
    }

    function capacity(bytes32 commitmentId) external view returns (Capacity memory) {
        return _capacity(registry.getCommitment(commitmentId).quote);
    }

    function buildTakerTraits(bytes32 commitmentId) external view returns (bytes memory) {
        Commitment memory commitment = registry.getCommitment(commitmentId);
        return _buildTakerTraits(commitmentId, commitment.quote);
    }

    function _executeAqua(bytes32 commitmentId, FirmQuote memory quote, ISwapVM.Order calldata order)
        private
        returns (uint256 amountOut)
    {
        bytes memory takerTraits = _buildTakerTraits(commitmentId, quote);
        (uint256 quotedIn, uint256 quotedOut, bytes32 quotedHash) = router.quote(order, quote.amountIn, takerTraits);
        if (quotedIn != quote.amountIn || quotedOut != quote.minOut || quotedHash != quote.orderHash) {
            revert QuoteResultMismatch();
        }

        IERC20 inputToken = IERC20(quote.tokenIn);
        _pullExact(inputToken, quote.trader, quote.amountIn);
        inputToken.forceApprove(address(router), quote.amountIn);
        (uint256 swappedIn, uint256 swappedOut, bytes32 swappedHash) = router.swap(order, quote.amountIn, takerTraits);
        inputToken.forceApprove(address(router), 0);
        if (swappedIn != quote.amountIn || swappedOut != quote.minOut || swappedHash != quote.orderHash) {
            revert SwapResultMismatch();
        }
        return swappedOut;
    }

    function _capacity(FirmQuote memory quote) private view returns (Capacity memory result) {
        (uint248 virtualOut, uint8 outTokenCount) = aqua.rawBalances(
            quote.maker,
            address(router),
            quote.orderHash,
            quote.tokenOut
        );
        (, uint8 inTokenCount) = aqua.rawBalances(
            quote.maker,
            address(router),
            quote.orderHash,
            quote.tokenIn
        );

        result.virtualBalance = uint256(virtualOut);
        result.realBalance = IERC20(quote.tokenOut).balanceOf(quote.maker);
        result.aquaAllowance = IERC20(quote.tokenOut).allowance(quote.maker, address(aqua));
        result.effectiveCapacity = _min(result.virtualBalance, _min(result.realBalance, result.aquaAllowance));
        result.strategyActive = _activeTokenCount(inTokenCount) && _activeTokenCount(outTokenCount);
    }

    function _buildTakerTraits(bytes32 commitmentId, FirmQuote memory quote) private view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(this),
            isExactIn: true,
            shouldUnwrapWeth: false,
            isStrictThresholdAmount: true,
            isFirstTransferFromTaker: true,
            useTransferFromAndAquaPush: true,
            isAToB: quote.tokenIn < quote.tokenOut,
            allowPartialFill: false,
            threshold: abi.encode(quote.minOut),
            to: quote.trader,
            deadline: uint40(quote.expiry),
            hasPreTransferInCallback: false,
            hasPreTransferOutCallback: false,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: abi.encodePacked(commitmentId, commitmentId),
            signature: ""
        }));
    }

    function _pullExact(IERC20 token, address from, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert DeflationaryTokenUnsupported();
    }

    function _activeTokenCount(uint8 count) private pure returns (bool) {
        return count != 0 && count != type(uint8).max;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}

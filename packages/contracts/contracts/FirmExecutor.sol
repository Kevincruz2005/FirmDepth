// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraits, MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { FirmAquaSwapVMRouter } from "./FirmAquaSwapVMRouter.sol";
import { Commitment, CommitmentStatus, FirmQuote, IFirmCommitmentRegistry } from "./types/FirmTypes.sol";

contract FirmExecutor is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using MakerTraitsLib for MakerTraits;

    bytes4 public constant FIRM_PROGRAM = 0x52002100;

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
    error SwapResultMismatch();
    error DeflationaryTokenUnsupported();
    error ZeroAddress();
    error InvalidFirmOrder();

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
        if (registry_ == address(0) || aqua_ == address(0) || router_ == address(0)) revert ZeroAddress();
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
        if (msg.sender != quote.taker) revert UnauthorizedTrader(quote.taker, msg.sender);
        if (block.timestamp > quote.expiry) revert CommitmentExpired(quote.expiry);

        _validateFirmOrder(quote, order);

        Capacity memory beforeAttempt = _capacity(quote);
        IERC20 inputToken = IERC20(quote.tokenIn);
        _pullExact(inputToken, quote.taker, quote.amountIn);

        if (!beforeAttempt.strategyActive || beforeAttempt.effectiveCapacity < quote.minAmountOut) {
            _transferExact(inputToken, quote.maker, quote.amountIn);
            amountOut = quote.minAmountOut;
            terminalStatus = CommitmentStatus.FILLED_BOND;
            registry.finalizeBond(commitmentId);
            emit PathSelected(
                commitmentId,
                false,
                beforeAttempt.virtualBalance,
                beforeAttempt.realBalance,
                beforeAttempt.aquaAllowance,
                beforeAttempt.effectiveCapacity,
                quote.minAmountOut
            );
        } else {
            IERC20 outputToken = IERC20(quote.tokenOut);
            inputToken.forceApprove(address(router), quote.amountIn);
            uint256 traderOutputBefore = outputToken.balanceOf(quote.taker);
            (uint256 swappedIn, uint256 swappedOut, bytes32 swappedHash) = router.swap(
                order,
                quote.amountIn,
                _buildTakerTraits(commitmentId, quote)
            );
            inputToken.forceApprove(address(router), 0);
            if (
                swappedIn != quote.amountIn
                    || swappedOut < quote.minAmountOut
                    || swappedHash != quote.orderHash
            ) {
                revert SwapResultMismatch();
            }
            uint256 received = outputToken.balanceOf(quote.taker) - traderOutputBefore;
            if (received < quote.minAmountOut || received != swappedOut) revert SwapResultMismatch();
            amountOut = swappedOut;
            terminalStatus = CommitmentStatus.FILLED_AQUA;
            registry.finalizeAqua(commitmentId);
            emit PathSelected(
                commitmentId,
                true,
                beforeAttempt.virtualBalance,
                beforeAttempt.realBalance,
                beforeAttempt.aquaAllowance,
                beforeAttempt.effectiveCapacity,
                quote.minAmountOut
            );
        }

        emit FirmTradeExecuted(
            commitmentId,
            terminalStatus,
            quote.taker,
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
        result.strategyActive = _activeTokenCount(inTokenCount) && _activeTokenCount(outTokenCount);
        result.effectiveCapacity = result.strategyActive
            ? _min(result.virtualBalance, _min(result.realBalance, result.aquaAllowance))
            : 0;
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
            threshold: abi.encode(quote.minAmountOut),
            to: quote.taker,
            deadline: uint40(quote.expiry),
            hasPreTransferInCallback: false,
            hasPreTransferOutCallback: false,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: abi.encodePacked(quote.minAmountOut, commitmentId),
            signature: ""
        }));
    }

    function _pullExact(IERC20 token, address from, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert DeflationaryTokenUnsupported();
    }

    function _transferExact(IERC20 token, address to, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(to);
        token.safeTransfer(to, amount);
        if (token.balanceOf(to) - beforeBalance != amount) revert DeflationaryTokenUnsupported();
    }

    function _validateFirmOrder(FirmQuote memory quote, ISwapVM.Order calldata order) private view {
        bytes32 actualOrderHash = router.hash(order);
        if (actualOrderHash != quote.orderHash) revert OrderHashMismatch(quote.orderHash, actualOrderHash);
        if (quote.swapRouter != address(router)) revert InvalidFirmOrder();

        bytes calldata program = order.traits.program(order.data);
        (address tokenA, address tokenB) = order.traits.tokens(order.data);
        (address expectedA, address expectedB) = quote.tokenIn < quote.tokenOut
            ? (quote.tokenIn, quote.tokenOut)
            : (quote.tokenOut, quote.tokenIn);
        if (
            order.maker != quote.maker
                || tokenA != expectedA
                || tokenB != expectedB
                || !order.traits.useAquaInsteadOfSignature()
                || order.traits.shouldUnwrapWeth()
                || order.traits.allowZeroAmountIn()
                || order.traits.hasPreTransferInHook()
                || order.traits.hasPostTransferInHook()
                || order.traits.hasPreTransferOutHook()
                || order.traits.hasPostTransferOutHook()
                || order.traits.receiver(order.maker) != order.maker
                || program.length != 4
                || bytes4(program) != FIRM_PROGRAM
        ) revert InvalidFirmOrder();
    }

    function _activeTokenCount(uint8 count) private pure returns (bool) {
        return count != 0 && count != type(uint8).max;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}

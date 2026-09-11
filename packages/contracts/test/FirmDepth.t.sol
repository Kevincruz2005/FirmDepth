// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";

import { BondVault } from "../contracts/BondVault.sol";
import { FirmAquaSwapVMRouter } from "../contracts/FirmAquaSwapVMRouter.sol";
import { FirmCommitmentRegistry } from "../contracts/FirmCommitmentRegistry.sol";
import { FirmExecutor } from "../contracts/FirmExecutor.sol";
import { FirmGuard } from "../contracts/instructions/FirmGuard.sol";
import { FirmPrice } from "../contracts/instructions/FirmPrice.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { Commitment, CommitmentStatus, FirmQuote } from "../contracts/types/FirmTypes.sol";

contract MockERC1271Maker is IERC1271 {
    enum Mode {
        VALID,
        INVALID,
        REVERT
    }

    bytes32 private _approvedDigest;
    bytes32 private _approvedSignatureHash;
    Mode private _mode;

    function configure(bytes32 digest, bytes calldata signature, Mode mode) external {
        _approvedDigest = digest;
        _approvedSignatureHash = keccak256(signature);
        _mode = mode;
    }

    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        if (_mode == Mode.REVERT) revert("wallet validation failed");
        if (
            _mode == Mode.VALID
                && digest == _approvedDigest
                && keccak256(signature) == _approvedSignatureHash
        ) return IERC1271.isValidSignature.selector;
        return 0xffffffff;
    }
}

contract FirmDepthTest is Test {
    event BondUnlocked(bytes32 indexed commitmentId, address indexed maker, uint256 amount);
    event BondReleased(bytes32 indexed commitmentId, address indexed maker, address indexed to, uint256 amount);

    uint256 private constant MAKER_KEY = 0xA11CE;
    uint256 private constant TRADER_KEY = 0xB0B;
    uint256 private constant AMOUNT_IN = 0.25 ether;
    uint256 private constant MIN_OUT = 625e6;
    uint256 private constant PREMIUM = 250_000_000_000_000;
    uint256 private constant MIN_PREMIUM_OUT = 625_000;
    uint256 private constant UTILIZATION_AFTER_WAD = 312_500_000_000_000_000;
    uint256 private constant BOND_DEPOSIT = 2_000e6;
    uint256 private constant AQUA_OUTPUT = 5_000e6;
    uint64 private constant MAX_QUOTE_TTL = 300;

    address private maker;
    address private trader;

    MockERC20 private weth;
    MockERC20 private usdc;
    Aqua private aqua;
    BondVault private vault;
    FirmCommitmentRegistry private registry;
    FirmAquaSwapVMRouter private router;
    FirmExecutor private executor;

    function setUp() public {
        maker = vm.addr(MAKER_KEY);
        trader = vm.addr(TRADER_KEY);

        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        aqua = new Aqua();
        vault = new BondVault(address(usdc), address(this));
        registry = new FirmCommitmentRegistry(
            address(vault),
            address(weth),
            address(usdc),
            address(this),
            MAX_QUOTE_TTL
        );
        router = new FirmAquaSwapVMRouter(
            address(aqua),
            address(weth),
            address(this),
            address(registry),
            address(vault)
        );
        executor = new FirmExecutor(address(registry), address(aqua), address(router));

        vault.setRegistry(address(registry));
        registry.setExecutor(address(executor));

        usdc.mint(maker, 10_000e6);
        usdc.mint(trader, 100e6);
        weth.mint(trader, 10 ether);

        vm.startPrank(maker);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(BOND_DEPOSIT);
        usdc.approve(address(aqua), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(trader);
        weth.approve(address(registry), type(uint256).max);
        weth.approve(address(executor), type(uint256).max);
        vm.stopPrank();

        _shipStrategy();
    }

    function testAquaPathUsesOfficialAquaAndUnlocksBond() public {
        (bytes32 commitmentId,) = _accept(1);
        ISwapVM.Order memory order = _order();

        uint256 traderWethBefore = weth.balanceOf(trader);
        uint256 traderUsdcBefore = usdc.balanceOf(trader);
        uint256 makerWethBefore = weth.balanceOf(maker);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);

        vm.prank(trader);
        (CommitmentStatus result, uint256 amountOut) = executor.execute(commitmentId, order);

        assertEq(uint8(result), uint8(CommitmentStatus.FILLED_AQUA));
        assertEq(amountOut, MIN_OUT);
        assertEq(weth.balanceOf(trader), traderWethBefore - AMOUNT_IN);
        assertEq(usdc.balanceOf(trader), traderUsdcBefore + MIN_OUT);
        assertEq(weth.balanceOf(maker), makerWethBefore + AMOUNT_IN + PREMIUM);
        assertEq(usdc.balanceOf(maker), makerUsdcBefore - MIN_OUT);
        assertEq(vault.availableOf(maker), BOND_DEPOSIT);
        assertEq(vault.lockedOf(maker), 0);

        Commitment memory settled = registry.getCommitment(commitmentId);
        assertEq(uint8(settled.status), uint8(CommitmentStatus.FILLED_AQUA));

        (uint248 virtualWeth,) = aqua.rawBalances(maker, address(router), settled.quote.orderHash, address(weth));
        (uint248 virtualUsdc,) = aqua.rawBalances(maker, address(router), settled.quote.orderHash, address(usdc));
        assertEq(uint256(virtualWeth), AMOUNT_IN);
        assertEq(uint256(virtualUsdc), AQUA_OUTPUT - MIN_OUT);
    }

    function testOfficialAquaSoftDepthCanExceedRealSharedInventory() public {
        ISwapVM.Order memory first = _softOrder(1);
        ISwapVM.Order memory second = _softOrder(2);
        _shipOrder(first, AQUA_OUTPUT);
        _shipOrder(second, AQUA_OUTPUT);

        (uint248 firstVirtual,) = aqua.rawBalances(
            maker,
            address(router),
            router.hash(first),
            address(usdc)
        );
        (uint248 secondVirtual,) = aqua.rawBalances(
            maker,
            address(router),
            router.hash(second),
            address(usdc)
        );
        assertEq(uint256(firstVirtual) + uint256(secondVirtual), 10_000e6);
        assertEq(usdc.balanceOf(maker), 8_000e6);

        weth.mint(address(this), 2 ether);
        weth.approve(address(router), type(uint256).max);
        (, uint256 firstOutput,) = router.swap(first, 1 ether, _softTakerTraits());
        assertEq(firstOutput, AQUA_OUTPUT);
        assertEq(usdc.balanceOf(maker), 3_000e6);

        vm.expectRevert();
        router.swap(second, 1 ether, _softTakerTraits());
        assertEq(weth.balanceOf(address(this)), 1 ether);
    }

    function testBondPathWhenRealAllowanceIsRemoved() public {
        (bytes32 commitmentId,) = _accept(2);
        vm.prank(maker);
        usdc.approve(address(aqua), 0);

        FirmExecutor.Capacity memory available = executor.capacity(commitmentId);
        assertEq(available.virtualBalance, AQUA_OUTPUT);
        assertEq(available.realBalance, 8_000e6);
        assertEq(available.aquaAllowance, 0);
        assertEq(available.effectiveCapacity, 0);

        uint256 traderWethBefore = weth.balanceOf(trader);
        uint256 traderUsdcBefore = usdc.balanceOf(trader);
        uint256 makerWethBefore = weth.balanceOf(maker);

        vm.prank(trader);
        (CommitmentStatus result, uint256 amountOut) = executor.execute(commitmentId, _order());

        assertEq(uint8(result), uint8(CommitmentStatus.FILLED_BOND));
        assertEq(amountOut, MIN_OUT);
        assertEq(weth.balanceOf(trader), traderWethBefore - AMOUNT_IN);
        assertEq(usdc.balanceOf(trader), traderUsdcBefore + MIN_OUT);
        assertEq(weth.balanceOf(maker), makerWethBefore + AMOUNT_IN + PREMIUM);
        assertEq(vault.availableOf(maker), BOND_DEPOSIT - MIN_OUT);
        assertEq(vault.lockedOf(maker), 0);
        assertEq(vault.liabilities(), BOND_DEPOSIT - MIN_OUT);

        Commitment memory settled = registry.getCommitment(commitmentId);
        assertEq(uint8(settled.status), uint8(CommitmentStatus.FILLED_BOND));
    }

    function testAcceptanceRejectsCapacityLostBeforeCommitment() public {
        FirmQuote memory quote = _quote(81);
        bytes memory signature = _sign(quote);
        vm.prank(maker);
        usdc.approve(address(aqua), 0);

        vm.expectRevert(
            abi.encodeWithSelector(FirmExecutor.IneligibleAquaCapacity.selector, 0, MIN_OUT)
        );
        vm.prank(trader);
        registry.accept(quote, _order(), signature);

        bytes32 commitmentId = registry.quoteDigest(quote);
        assertEq(uint8(registry.getCommitment(commitmentId).status), uint8(CommitmentStatus.NONE));
        assertFalse(registry.nonceUsed(maker, quote.nonce));
        assertEq(vault.lockedOf(maker), 0);
        assertEq(usdc.balanceOf(address(registry)), 0);
        assertEq(weth.balanceOf(trader), 10 ether);
    }

    function testAcceptanceRecordsCurrentBlock() public {
        (bytes32 commitmentId,) = _accept(82);
        assertEq(registry.getCommitment(commitmentId).acceptedBlock, block.number);
    }

    function testBondPathAfterInterveningSoftSwapExhaustsRealInventory() public {
        ISwapVM.Order memory softOrder = _softOrder(77);
        _shipOrder(softOrder, 7_500e6);
        (bytes32 commitmentId,) = _accept(77);

        weth.mint(address(this), 1 ether);
        weth.approve(address(router), 1 ether);
        router.swap(softOrder, 1 ether, _softTakerTraits());
        assertEq(usdc.balanceOf(maker), 500e6);

        uint256 traderWethBefore = weth.balanceOf(trader);
        uint256 traderUsdcBefore = usdc.balanceOf(trader);
        uint256 makerWethBefore = weth.balanceOf(maker);

        vm.prank(trader);
        (CommitmentStatus result, uint256 amountOut) = executor.execute(commitmentId, _order());

        assertEq(uint8(result), uint8(CommitmentStatus.FILLED_BOND));
        assertEq(amountOut, MIN_OUT);
        assertEq(weth.balanceOf(trader), traderWethBefore - AMOUNT_IN);
        assertEq(usdc.balanceOf(trader), traderUsdcBefore + MIN_OUT);
        assertEq(weth.balanceOf(maker), makerWethBefore + AMOUNT_IN + PREMIUM);
        assertEq(vault.lockedOf(maker), 0);
    }

    function testUnrelatedAquaFailureRevertsAllPartialStateAndCannotConsumeBond() public {
        (bytes32 commitmentId,) = _accept(78);
        Commitment memory accepted = registry.getCommitment(commitmentId);
        uint256 traderWethBefore = weth.balanceOf(trader);
        uint256 traderUsdcBefore = usdc.balanceOf(trader);
        uint256 makerWethBefore = weth.balanceOf(maker);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);
        uint256 registryPremiumBefore = weth.balanceOf(address(registry));
        (uint248 virtualWethBefore,) = aqua.rawBalances(
            maker,
            address(router),
            accepted.quote.orderHash,
            address(weth)
        );
        (uint248 virtualUsdcBefore,) = aqua.rawBalances(
            maker,
            address(router),
            accepted.quote.orderHash,
            address(usdc)
        );
        usdc.setTransferFromReverts(true);

        vm.expectRevert(bytes4(keccak256("SafeTransferFromFailed()")));
        vm.prank(trader);
        executor.execute(commitmentId, _order());

        assertEq(uint8(registry.getCommitment(commitmentId).status), uint8(CommitmentStatus.ACCEPTED));
        assertEq(vault.lockedOf(maker), MIN_OUT);
        assertEq(weth.balanceOf(trader), traderWethBefore);
        assertEq(usdc.balanceOf(trader), traderUsdcBefore);
        assertEq(weth.balanceOf(maker), makerWethBefore);
        assertEq(usdc.balanceOf(maker), makerUsdcBefore);
        assertEq(weth.balanceOf(address(executor)), 0);
        assertEq(weth.balanceOf(address(router)), 0);
        assertEq(weth.allowance(address(executor), address(router)), 0);
        assertEq(weth.balanceOf(address(registry)), registryPremiumBefore);
        (uint248 virtualWethAfter,) = aqua.rawBalances(
            maker,
            address(router),
            accepted.quote.orderHash,
            address(weth)
        );
        (uint248 virtualUsdcAfter,) = aqua.rawBalances(
            maker,
            address(router),
            accepted.quote.orderHash,
            address(usdc)
        );
        assertEq(virtualWethAfter, virtualWethBefore);
        assertEq(virtualUsdcAfter, virtualUsdcBefore);

        usdc.setTransferFromReverts(false);
        vm.prank(trader);
        (CommitmentStatus result,) = executor.execute(commitmentId, _order());
        assertEq(uint8(result), uint8(CommitmentStatus.FILLED_AQUA));
        assertEq(weth.balanceOf(maker), makerWethBefore + AMOUNT_IN + PREMIUM);
        assertEq(weth.balanceOf(address(registry)), 0);
    }

    function testEmptyAndPanicTokenFailuresCannotConsumeBond() public {
        (bytes32 commitmentId,) = _accept(91);
        uint256 traderWethBefore = weth.balanceOf(trader);
        uint256 traderUsdcBefore = usdc.balanceOf(trader);
        uint256 makerWethBefore = weth.balanceOf(maker);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);

        usdc.setTransferFromRevertsEmpty(true);
        vm.expectRevert();
        vm.prank(trader);
        executor.execute(commitmentId, _order());
        _assertFailedExecutionState(
            commitmentId,
            traderWethBefore,
            traderUsdcBefore,
            makerWethBefore,
            makerUsdcBefore
        );

        usdc.setTransferFromRevertsEmpty(false);
        usdc.setTransferFromPanics(true);
        vm.expectRevert();
        vm.prank(trader);
        executor.execute(commitmentId, _order());
        _assertFailedExecutionState(
            commitmentId,
            traderWethBefore,
            traderUsdcBefore,
            makerWethBefore,
            makerUsdcBefore
        );
    }

    function testMalformedOrderTokensCannotBeAccepted() public {
        MockERC20 wrongToken = new MockERC20("Wrong Token", "WRONG", 18);
        ISwapVM.Order memory malformed = _orderWithTokens(address(weth), address(wrongToken));
        FirmQuote memory quote = _quoteForOrder(79, malformed);
        bytes memory signature = _sign(quote);
        vm.expectRevert(FirmExecutor.InvalidFirmOrder.selector);
        vm.prank(trader);
        registry.accept(quote, malformed, signature);
    }

    function testStaticFirmQuoteWorksBeforeCommitmentAcceptance() public {
        ISwapVM.Order memory order = _order();
        bytes memory takerTraits = _firmQuoteTakerTraits(MIN_OUT, bytes32(0));

        (uint256 quotedIn, uint256 quotedOut, bytes32 quotedHash) = router.quote(
            order,
            AMOUNT_IN,
            takerTraits
        );

        assertEq(quotedIn, AMOUNT_IN);
        assertEq(quotedOut, MIN_OUT);
        assertEq(quotedHash, router.hash(order));
    }

    function testSdkStaticQuoteTraitsLayoutMatchesPinnedSwapVM() public {
        bytes memory sliceIndexes = hex"0060002000200020002000200020002000200020";
        bytes2 flags = address(weth) < address(usdc) ? bytes2(0x00f1) : bytes2(0x0071);
        bytes memory sdkLayout = abi.encodePacked(
            sliceIndexes,
            flags,
            MIN_OUT,
            MIN_OUT,
            bytes32(0)
        );

        (uint256 quotedIn, uint256 quotedOut, bytes32 quotedHash) = router.quote(
            _order(),
            AMOUNT_IN,
            sdkLayout
        );

        assertEq(quotedIn, AMOUNT_IN);
        assertEq(quotedOut, MIN_OUT);
        assertEq(quotedHash, router.hash(_order()));
    }

    function testSdkRuntimeTraitsMatchExecutorAndBindNativeThresholdAndDeadline() public {
        (bytes32 commitmentId, FirmQuote memory quote) = _accept(100);
        bytes memory sliceIndexes = hex"0079003900390039003900390039003900340020";
        bytes2 flags = address(weth) < address(usdc) ? bytes2(0x00f1) : bytes2(0x0071);
        bytes memory sdkLayout = abi.encodePacked(
            sliceIndexes,
            flags,
            quote.minAmountOut,
            trader,
            uint40(quote.expiry),
            quote.minAmountOut,
            commitmentId
        );

        assertEq(executor.buildTakerTraits(commitmentId), sdkLayout);
        bytes32 nativeThreshold;
        uint40 nativeDeadline;
        assembly ("memory-safe") {
            nativeThreshold := mload(add(sdkLayout, 54))
            nativeDeadline := shr(216, mload(add(sdkLayout, 106)))
        }
        assertEq(uint256(nativeThreshold), quote.minAmountOut);
        assertEq(nativeDeadline, uint40(quote.expiry));
    }

    function testGuardRejectsSwapFromAnyoneExceptSignedExecutor() public {
        (bytes32 commitmentId,) = _accept(3);
        bytes memory takerTraits = executor.buildTakerTraits(commitmentId);

        vm.expectRevert(
            abi.encodeWithSelector(FirmGuard.ExecutorMismatch.selector, address(executor), address(this))
        );
        router.swap(_order(), AMOUNT_IN, takerTraits);
        assertEq(vault.lockedOf(maker), MIN_OUT);
    }

    function testFirmPriceRejectsOutputDifferentFromAcceptedSnapshot() public {
        (bytes32 commitmentId,) = _accept(83);
        bytes memory takerTraits = _firmQuoteTakerTraits(MIN_OUT + 1, commitmentId);

        vm.expectRevert(
            abi.encodeWithSelector(FirmPrice.OutputMismatch.selector, MIN_OUT, MIN_OUT + 1)
        );
        vm.prank(address(executor));
        router.swap(_order(), AMOUNT_IN, takerTraits);
        assertEq(vault.lockedOf(maker), MIN_OUT);
    }

    function testNativeThresholdDeadlineAndMalformedArgsCannotConsumeBond() public {
        (bytes32 commitmentId, FirmQuote memory quote) = _accept(101);

        bytes memory wrongThreshold = _runtimeTraits(
            MIN_OUT + 1,
            uint40(quote.expiry),
            abi.encodePacked(MIN_OUT, commitmentId)
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                TakerTraitsLib.TakerTraitsNonExactThresholdAmountOut.selector,
                MIN_OUT,
                MIN_OUT + 1
            )
        );
        vm.prank(address(executor));
        router.swap(_order(), AMOUNT_IN, wrongThreshold);
        assertEq(vault.lockedOf(maker), MIN_OUT);

        vm.warp(block.timestamp + 1);
        bytes memory expiredDeadline = _runtimeTraits(
            MIN_OUT,
            uint40(block.timestamp - 1),
            abi.encodePacked(MIN_OUT, commitmentId)
        );
        vm.expectRevert(TakerTraitsLib.TakerTraitsDeadlineExpired.selector);
        vm.prank(address(executor));
        router.swap(_order(), AMOUNT_IN, expiredDeadline);
        assertEq(vault.lockedOf(maker), MIN_OUT);

        bytes memory malformedArgs = _runtimeTraits(
            MIN_OUT,
            uint40(quote.expiry),
            abi.encodePacked(MIN_OUT)
        );
        vm.expectRevert(FirmGuard.MissingCommitmentId.selector);
        vm.prank(address(executor));
        router.swap(_order(), AMOUNT_IN, malformedArgs);
        assertEq(vault.lockedOf(maker), MIN_OUT);
        assertEq(uint8(registry.getCommitment(commitmentId).status), uint8(CommitmentStatus.ACCEPTED));
    }

    function testArbitraryRouterFailureRevertsInputPullAndCannotConsumeBond() public {
        (bytes32 commitmentId,) = _accept(102);
        ISwapVM.Order memory order = _order();
        bytes memory callData = abi.encodeCall(
            ISwapVM.swap,
            (order, AMOUNT_IN, executor.buildTakerTraits(commitmentId))
        );
        vm.mockCallRevert(address(router), callData, abi.encodeWithSignature("Error(string)", "router failure"));

        uint256 traderWethBefore = weth.balanceOf(trader);
        uint256 makerWethBefore = weth.balanceOf(maker);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "router failure"));
        vm.prank(trader);
        executor.execute(commitmentId, order);

        assertEq(weth.balanceOf(trader), traderWethBefore);
        assertEq(weth.balanceOf(maker), makerWethBefore);
        assertEq(vault.lockedOf(maker), MIN_OUT);
        assertEq(uint8(registry.getCommitment(commitmentId).status), uint8(CommitmentStatus.ACCEPTED));
    }

    function testReentrantTokenCallbackRevertsEverythingAndCannotConsumeBond() public {
        (bytes32 commitmentId,) = _accept(103);
        weth.setTransferFromCallback(
            address(executor),
            abi.encodeCall(FirmExecutor.execute, (commitmentId, _order()))
        );
        uint256 traderWethBefore = weth.balanceOf(trader);
        uint256 makerWethBefore = weth.balanceOf(maker);

        vm.expectRevert();
        vm.prank(trader);
        executor.execute(commitmentId, _order());

        assertEq(weth.balanceOf(trader), traderWethBefore);
        assertEq(weth.balanceOf(maker), makerWethBefore);
        assertEq(vault.lockedOf(maker), MIN_OUT);
        assertEq(uint8(registry.getCommitment(commitmentId).status), uint8(CommitmentStatus.ACCEPTED));
    }

    function testExecutionDoesNotRepriceAfterVaultUtilizationChanges() public {
        (bytes32 commitmentId,) = _accept(84);
        usdc.mint(maker, BOND_DEPOSIT);
        vm.startPrank(maker);
        usdc.approve(address(vault), BOND_DEPOSIT);
        vault.deposit(BOND_DEPOSIT);
        vm.stopPrank();

        vm.prank(trader);
        (CommitmentStatus result,) = executor.execute(commitmentId, _order());

        assertEq(uint8(result), uint8(CommitmentStatus.FILLED_AQUA));
    }

    function testReplayAndDoubleSettlementAreRejected() public {
        (bytes32 commitmentId, FirmQuote memory quote) = _accept(4);
        bytes memory signature = _sign(quote);

        vm.expectRevert(
            abi.encodeWithSelector(FirmCommitmentRegistry.NonceAlreadyUsed.selector, maker, quote.nonce)
        );
        vm.prank(trader);
        registry.accept(quote, _order(), signature);

        vm.prank(trader);
        executor.execute(commitmentId, _order());

        vm.expectRevert();
        vm.prank(trader);
        executor.execute(commitmentId, _order());
    }

    function testOnlySignedTakerCanAcceptAndExecute() public {
        address unauthorized = makeAddr("unauthorized");
        FirmQuote memory quote = _quote(94);
        bytes memory signature = _sign(quote);

        vm.expectRevert(
            abi.encodeWithSelector(FirmCommitmentRegistry.WrongTaker.selector, trader, unauthorized)
        );
        vm.prank(unauthorized);
        registry.accept(quote, _order(), signature);

        vm.prank(trader);
        bytes32 commitmentId = registry.accept(quote, _order(), signature);
        vm.expectRevert(
            abi.encodeWithSelector(FirmExecutor.UnauthorizedTrader.selector, trader, unauthorized)
        );
        vm.prank(unauthorized);
        executor.execute(commitmentId, _order());
    }

    function testQuoteCannotSelectAnotherExecutor() public {
        FirmQuote memory quote = _quote(95);
        quote.executor = makeAddr("other executor");
        bytes memory signature = _sign(quote);

        vm.expectRevert(
            abi.encodeWithSelector(
                FirmCommitmentRegistry.WrongExecutor.selector,
                address(executor),
                quote.executor
            )
        );
        vm.prank(trader);
        registry.accept(quote, _order(), signature);
    }

    function testQuoteDigestBindsRouterAndPricingTerms() public view {
        FirmQuote memory quote = _quote(44);
        bytes32 digest = registry.quoteDigest(quote);

        FirmQuote memory changed = quote;
        changed.maker = address(0x1001);
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.taker = address(0x1002);
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.executor = address(0x1003);
        assertNotEq(registry.quoteDigest(changed), digest);

        changed.swapRouter = address(0x1234);
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.orderHash = bytes32(uint256(1));
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.tokenIn = address(0x1004);
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.tokenOut = address(0x1005);
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.amountIn += 1;
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.referenceAmountOut += 1;
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.minAmountOut += 1;
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.requiredBond += 1;
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.premiumToken = address(0x1006);
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.premiumAmount += 1;
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.pricingVersion += 1;
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.sigmaWad += 1;
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.annualCapitalRateWad += 1;
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.capacityKBps += 1;
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.utilizationAfterWad += 1;
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.minPremiumOut += 1;
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.pricingTtl += 1;
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.expiry += 1;
        assertNotEq(registry.quoteDigest(changed), digest);

        changed = quote;
        changed.nonce += 1;
        assertNotEq(registry.quoteDigest(changed), digest);
    }

    function testFirmQuoteEip712GoldenVectorMatchesSdk() public pure {
        bytes32 typeHash = keccak256(
            "FirmQuote(address maker,address taker,address executor,address swapRouter,bytes32 orderHash,address tokenIn,address tokenOut,uint256 amountIn,uint256 referenceAmountOut,uint256 minAmountOut,uint256 requiredBond,address premiumToken,uint256 premiumAmount,uint32 pricingVersion,uint256 sigmaWad,uint256 annualCapitalRateWad,uint16 capacityKBps,uint256 utilizationAfterWad,uint256 minPremiumOut,uint32 pricingTtl,uint64 expiry,uint256 nonce)"
        );
        FirmQuote memory quote = FirmQuote({
            maker: 0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7,
            taker: address(2),
            executor: address(3),
            swapRouter: address(6),
            orderHash: bytes32(uint256(type(uint256).max / 15)),
            tokenIn: address(4),
            tokenOut: address(5),
            amountIn: 250_000_000_000_000_000,
            referenceAmountOut: 630_000_000,
            minAmountOut: 625_000_000,
            requiredBond: 625_000_000,
            premiumToken: address(4),
            premiumAmount: 250_000_000_000_000,
            pricingVersion: 2,
            sigmaWad: 800_000_000_000_000_000,
            annualCapitalRateWad: 100_000_000_000_000_000,
            capacityKBps: 10,
            utilizationAfterWad: 500_000_000_000_000_000,
            minPremiumOut: 100_000,
            pricingTtl: 30,
            expiry: 2_000_000_000,
            nonce: 1
        });
        bytes32 structHash = keccak256(abi.encode(
            typeHash,
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
            quote.pricingTtl,
            quote.expiry,
            quote.nonce
        ));
        assertEq(structHash, 0x1d4bb27bace9c40f1aa789756cd2773857c08a303c014178044f25948440fb44);

        bytes32 domainSeparator = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("FirmDepth"),
            keccak256("1"),
            uint256(31_337),
            address(0x10)
        ));
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
        assertEq(digest, 0x589b7a520fa4c984880d9cc176f1144d3d4efb401e2ff007fa7a795745593a50);
        address recovered = ecrecover(
            digest,
            27,
            0x58effceba4850b5b7e05a4b76dff2ffc1444c680d311b1d813df1199aa7226c8,
            0x020e81f10ed99070a23378e656484964a2b6294538df46a070d1d072f8b210c4
        );
        assertEq(recovered, quote.maker);
    }

    function testBondSettlementIsTerminalAndLockedCollateralCannotBeWithdrawn() public {
        (bytes32 commitmentId,) = _accept(6);

        vm.expectRevert(
            abi.encodeWithSelector(BondVault.InsufficientAvailable.selector, BOND_DEPOSIT - MIN_OUT, BOND_DEPOSIT)
        );
        vm.prank(maker);
        vault.withdraw(BOND_DEPOSIT, maker);

        vm.prank(maker);
        usdc.approve(address(aqua), 0);
        vm.prank(trader);
        executor.execute(commitmentId, _order());

        vm.expectRevert(
            abi.encodeWithSelector(
                FirmExecutor.CommitmentNotAccepted.selector,
                commitmentId,
                CommitmentStatus.FILLED_BOND
            )
        );
        vm.prank(trader);
        executor.execute(commitmentId, _order());
    }

    function testBondSettlementReturnsOvercollateralizedExcessToMaker() public {
        FirmQuote memory quote = _quote(85);
        quote.referenceAmountOut = 700e6;
        quote.minAmountOut = 700e6;
        quote.requiredBond = 750e6;
        quote.utilizationAfterWad = registry.utilizationAfter(maker, quote.requiredBond);
        quote.premiumAmount = registry.quotePremium(quote).premiumIn;
        bytes memory signature = _sign(quote);
        vm.prank(trader);
        bytes32 commitmentId = registry.accept(quote, _order(), signature);

        uint256 traderOutputBefore = usdc.balanceOf(trader);
        uint256 makerInputBefore = weth.balanceOf(maker);
        vm.prank(maker);
        usdc.approve(address(aqua), 0);

        vm.expectEmit(true, true, false, true, address(vault));
        emit BondUnlocked(commitmentId, maker, 50e6);
        vm.expectEmit(true, true, true, true, address(vault));
        emit BondReleased(commitmentId, maker, trader, 700e6);
        vm.prank(trader);
        (CommitmentStatus result, uint256 amountOut) = executor.execute(commitmentId, _order());

        assertEq(uint8(result), uint8(CommitmentStatus.FILLED_BOND));
        assertEq(amountOut, 700e6);
        assertEq(usdc.balanceOf(trader) - traderOutputBefore, 700e6);
        assertEq(weth.balanceOf(maker) - makerInputBefore, AMOUNT_IN + quote.premiumAmount);
        assertEq(vault.lockedOf(maker), 0);
        assertEq(vault.availableOf(maker), BOND_DEPOSIT - 700e6);
        assertEq(vault.liabilities(), BOND_DEPOSIT - 700e6);
        (address lockedMaker, uint256 lockedAmount) = vault.lockedFor(commitmentId);
        assertEq(lockedMaker, address(0));
        assertEq(lockedAmount, 0);
    }

    function testPostAcceptanceStrategyUnavailabilityUsesDedicatedBond() public {
        (bytes32 commitmentId, FirmQuote memory quote) = _accept(86);
        (address lockedMaker, uint256 lockedAmount) = vault.lockedFor(commitmentId);
        assertEq(lockedMaker, maker);
        assertEq(lockedAmount, quote.requiredBond);

        address[] memory tokens = new address[](2);
        tokens[0] = address(weth);
        tokens[1] = address(usdc);
        vm.prank(maker);
        aqua.dock(address(router), quote.orderHash, tokens);

        FirmExecutor.Capacity memory available = executor.capacity(commitmentId);
        assertFalse(available.strategyActive);
        assertEq(available.effectiveCapacity, 0);

        uint256 traderInputBefore = weth.balanceOf(trader);
        uint256 traderOutputBefore = usdc.balanceOf(trader);
        uint256 makerInputBefore = weth.balanceOf(maker);
        vm.prank(trader);
        (CommitmentStatus result, uint256 amountOut) = executor.execute(commitmentId, _order());

        assertEq(uint8(result), uint8(CommitmentStatus.FILLED_BOND));
        assertEq(amountOut, MIN_OUT);
        assertEq(weth.balanceOf(trader), traderInputBefore - AMOUNT_IN);
        assertEq(usdc.balanceOf(trader), traderOutputBefore + MIN_OUT);
        assertEq(weth.balanceOf(maker), makerInputBefore + AMOUNT_IN + PREMIUM);
        assertEq(vault.lockedOf(maker), 0);
        assertEq(uint8(registry.getCommitment(commitmentId).status), uint8(CommitmentStatus.FILLED_BOND));

        (uint248 virtualInput, uint8 inputCount) = aqua.rawBalances(
            maker, address(router), quote.orderHash, address(weth)
        );
        (uint248 virtualOutput, uint8 outputCount) = aqua.rawBalances(
            maker, address(router), quote.orderHash, address(usdc)
        );
        assertEq(uint256(virtualInput), 0);
        assertEq(uint256(virtualOutput), 0);
        assertEq(inputCount, type(uint8).max);
        assertEq(outputCount, type(uint8).max);
    }

    function testStrategyInactiveBeforeAcceptanceIsRejectedAtomically() public {
        FirmQuote memory quote = _quote(87);
        bytes memory signature = _sign(quote);
        address[] memory tokens = new address[](2);
        tokens[0] = address(weth);
        tokens[1] = address(usdc);
        vm.prank(maker);
        aqua.dock(address(router), quote.orderHash, tokens);

        uint256 traderInputBefore = weth.balanceOf(trader);
        vm.expectRevert(
            abi.encodeWithSelector(FirmExecutor.IneligibleAquaCapacity.selector, 0, MIN_OUT)
        );
        vm.prank(trader);
        registry.accept(quote, _order(), signature);

        bytes32 commitmentId = registry.quoteDigest(quote);
        assertEq(uint8(registry.getCommitment(commitmentId).status), uint8(CommitmentStatus.NONE));
        assertFalse(registry.nonceUsed(maker, quote.nonce));
        assertEq(vault.lockedOf(maker), 0);
        assertEq(weth.balanceOf(trader), traderInputBefore);
        assertEq(weth.balanceOf(address(registry)), 0);
    }

    function testActiveStrategyVirtualCapacityBelowMinimumUsesDedicatedBond() public {
        (bytes32 commitmentId,) = _accept(104);
        usdc.mint(maker, 10_000e6);
        vm.startPrank(maker);
        usdc.approve(address(vault), 6_000e6);
        vault.deposit(6_000e6);
        vm.stopPrank();

        for (uint256 nonce = 105; nonce < 113; nonce++) {
            FirmQuote memory sibling = _quote(nonce);
            sibling.utilizationAfterWad = registry.utilizationAfter(maker, sibling.requiredBond);
            sibling.premiumAmount = registry.quotePremium(sibling).premiumIn;
            bytes memory signature = _sign(sibling);
            vm.prank(trader);
            bytes32 siblingId = registry.accept(sibling, _order(), signature);
            vm.prank(trader);
            executor.execute(siblingId, _order());
        }

        FirmExecutor.Capacity memory available = executor.capacity(commitmentId);
        assertTrue(available.strategyActive);
        assertEq(available.virtualBalance, 0);
        assertGt(available.realBalance, MIN_OUT);
        assertGt(available.aquaAllowance, MIN_OUT);
        assertEq(available.effectiveCapacity, 0);

        vm.prank(trader);
        (CommitmentStatus result, uint256 amountOut) = executor.execute(commitmentId, _order());
        assertEq(uint8(result), uint8(CommitmentStatus.FILLED_BOND));
        assertEq(amountOut, MIN_OUT);
        assertEq(vault.lockedOf(maker), 0);
        assertEq(uint8(registry.getCommitment(commitmentId).status), uint8(CommitmentStatus.FILLED_BOND));
    }

    function testOneCommitmentCannotConsumeAnotherCommitmentLock() public {
        (bytes32 firstId,) = _accept(92);

        FirmQuote memory secondQuote = _quote(93);
        secondQuote.utilizationAfterWad = registry.utilizationAfter(maker, secondQuote.requiredBond);
        bytes memory secondSignature = _sign(secondQuote);
        vm.prank(trader);
        bytes32 secondId = registry.accept(secondQuote, _order(), secondSignature);

        vm.prank(maker);
        usdc.approve(address(aqua), 0);
        vm.prank(trader);
        executor.execute(firstId, _order());

        (address secondMaker, uint256 secondLock) = vault.lockedFor(secondId);
        assertEq(secondMaker, maker);
        assertEq(secondLock, MIN_OUT);
        assertEq(uint8(registry.getCommitment(secondId).status), uint8(CommitmentStatus.ACCEPTED));

        vm.prank(trader);
        executor.execute(secondId, _order());
        assertEq(vault.lockedOf(maker), 0);
        assertEq(uint8(registry.getCommitment(firstId).status), uint8(CommitmentStatus.FILLED_BOND));
        assertEq(uint8(registry.getCommitment(secondId).status), uint8(CommitmentStatus.FILLED_BOND));
    }

    function testMakerCancellationAfterAcceptanceCannotInvalidateCommitment() public {
        (bytes32 commitmentId, FirmQuote memory quote) = _accept(94);
        vm.startPrank(maker);
        registry.cancelNonce(quote.nonce);
        registry.raiseMinimumValidNonce(quote.nonce + 100);
        vm.stopPrank();

        vm.prank(trader);
        (CommitmentStatus result,) = executor.execute(commitmentId, _order());

        assertEq(uint8(result), uint8(CommitmentStatus.FILLED_AQUA));
    }

    function testExecutionAfterExpirySettlementCannotChangeTerminalState() public {
        (bytes32 commitmentId, FirmQuote memory quote) = _accept(95);
        vm.warp(uint256(quote.expiry) + 1);
        registry.expire(commitmentId);

        vm.expectRevert(
            abi.encodeWithSelector(
                FirmExecutor.CommitmentNotAccepted.selector,
                commitmentId,
                CommitmentStatus.EXPIRED
            )
        );
        vm.prank(trader);
        executor.execute(commitmentId, _order());

        assertEq(uint8(registry.getCommitment(commitmentId).status), uint8(CommitmentStatus.EXPIRED));
    }

    function testAcceptanceRejectsUndercollateralizedQuote() public {
        FirmQuote memory quote = _quote(86);
        quote.requiredBond = MIN_OUT - 1;
        bytes memory signature = _sign(quote);

        vm.expectRevert(
            abi.encodeWithSelector(
                FirmCommitmentRegistry.InsufficientRequiredBond.selector,
                MIN_OUT - 1,
                MIN_OUT
            )
        );
        vm.prank(trader);
        registry.accept(quote, _order(), signature);
    }

    function testAcceptanceRequiresEnoughUnlockedMakerCollateral() public {
        FirmQuote memory quote = _quote(96);
        quote.requiredBond = BOND_DEPOSIT + 1;
        quote.utilizationAfterWad = registry.utilizationAfter(maker, quote.requiredBond);
        bytes memory signature = _sign(quote);

        vm.expectRevert(
            abi.encodeWithSelector(
                BondVault.InsufficientAvailable.selector,
                BOND_DEPOSIT,
                BOND_DEPOSIT + 1
            )
        );
        vm.prank(trader);
        registry.accept(quote, _order(), signature);

        assertEq(vault.lockedOf(maker), 0);
        assertFalse(registry.nonceUsed(maker, quote.nonce));
    }

    function testBondSettlementRevertsIfOutputTokenDoesNotMove() public {
        (bytes32 commitmentId,) = _accept(8);
        vm.prank(maker);
        usdc.approve(address(aqua), 0);
        usdc.setTransferSkips(true);

        uint256 traderWethBefore = weth.balanceOf(trader);
        uint256 makerWethBefore = weth.balanceOf(maker);
        vm.expectRevert(BondVault.DeflationaryTokenUnsupported.selector);
        vm.prank(trader);
        executor.execute(commitmentId, _order());

        assertEq(weth.balanceOf(trader), traderWethBefore);
        assertEq(weth.balanceOf(maker), makerWethBefore);
        assertEq(uint8(registry.getCommitment(commitmentId).status), uint8(CommitmentStatus.ACCEPTED));
        assertEq(vault.lockedOf(maker), MIN_OUT);
    }

    function testExecutionAtExactExpiryBoundaryIsAllowedByDeadlinePolicy() public {
        (bytes32 commitmentId, FirmQuote memory quote) = _accept(7);
        vm.warp(uint256(quote.expiry));

        vm.prank(trader);
        (CommitmentStatus result,) = executor.execute(commitmentId, _order());

        assertEq(uint8(result), uint8(CommitmentStatus.FILLED_AQUA));
        assertEq(uint8(registry.getCommitment(commitmentId).status), uint8(CommitmentStatus.FILLED_AQUA));
    }

    function testExpiryReturnsBondAndPaysPremiumToMaker() public {
        (bytes32 commitmentId, FirmQuote memory quote) = _accept(5);
        uint256 makerBefore = weth.balanceOf(maker);
        vm.warp(uint256(quote.expiry) + 1);

        registry.expire(commitmentId);

        assertEq(vault.availableOf(maker), BOND_DEPOSIT);
        assertEq(weth.balanceOf(maker), makerBefore + PREMIUM);
        assertEq(uint8(registry.getCommitment(commitmentId).status), uint8(CommitmentStatus.EXPIRED));
    }

    function testMakerCanCancelSignedNonceOrRaiseNonceFloor() public {
        FirmQuote memory cancelled = _quote(10);
        bytes memory cancelledSignature = _sign(cancelled);
        vm.prank(maker);
        registry.cancelNonce(cancelled.nonce);

        vm.expectRevert(
            abi.encodeWithSelector(FirmCommitmentRegistry.NonceAlreadyUsed.selector, maker, cancelled.nonce)
        );
        vm.prank(trader);
        registry.accept(cancelled, _order(), cancelledSignature);

        FirmQuote memory belowFloor = _quote(20);
        bytes memory belowFloorSignature = _sign(belowFloor);
        vm.prank(maker);
        registry.raiseMinimumValidNonce(21);

        vm.expectRevert(
            abi.encodeWithSelector(FirmCommitmentRegistry.NonceBelowMinimum.selector, maker, 20, 21)
        );
        vm.prank(trader);
        registry.accept(belowFloor, _order(), belowFloorSignature);
    }

    function testErc1271MakerSignatureRequiresExactMagicValue() public {
        bytes memory walletSignature = hex"aabbccdd";
        FirmQuote memory quote = _quote(87);
        bytes32 digest = registry.quoteDigest(quote);
        MockERC1271Maker implementation = new MockERC1271Maker();
        vm.etch(maker, address(implementation).code);
        MockERC1271Maker(maker).configure(digest, walletSignature, MockERC1271Maker.Mode.VALID);

        vm.prank(trader);
        bytes32 commitmentId = registry.accept(quote, _order(), walletSignature);
        assertEq(uint8(registry.getCommitment(commitmentId).status), uint8(CommitmentStatus.ACCEPTED));
    }

    function testErc1271InvalidMagicAndRevertFailClosed() public {
        bytes memory walletSignature = hex"aabbccdd";
        FirmQuote memory quote = _quote(88);
        bytes32 digest = registry.quoteDigest(quote);
        MockERC1271Maker implementation = new MockERC1271Maker();
        vm.etch(maker, address(implementation).code);

        MockERC1271Maker(maker).configure(digest, walletSignature, MockERC1271Maker.Mode.INVALID);
        vm.expectRevert(
            abi.encodeWithSelector(FirmCommitmentRegistry.InvalidMakerSignature.selector, maker)
        );
        vm.prank(trader);
        registry.accept(quote, _order(), walletSignature);

        MockERC1271Maker(maker).configure(digest, walletSignature, MockERC1271Maker.Mode.REVERT);
        vm.expectRevert(
            abi.encodeWithSelector(FirmCommitmentRegistry.InvalidMakerSignature.selector, maker)
        );
        vm.prank(trader);
        registry.accept(quote, _order(), walletSignature);

        assertFalse(registry.nonceUsed(maker, quote.nonce));
        assertEq(vault.lockedOf(maker), 0);
    }

    function testMalleableEoaSignatureIsRejected() public {
        FirmQuote memory quote = _quote(89);
        bytes32 digest = registry.quoteDigest(quote);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_KEY, digest);
        uint256 curveOrder = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory malleable = abi.encodePacked(r, bytes32(curveOrder - uint256(s)), v == 27 ? uint8(28) : uint8(27));

        vm.expectRevert(
            abi.encodeWithSelector(FirmCommitmentRegistry.InvalidMakerSignature.selector, maker)
        );
        vm.prank(trader);
        registry.accept(quote, _order(), malleable);
    }

    function testQuoteCannotReplayAcrossChainOrRegistry() public {
        FirmQuote memory quote = _quote(90);
        bytes memory signature = _sign(quote);

        vm.chainId(block.chainid + 1);
        vm.expectRevert(
            abi.encodeWithSelector(FirmCommitmentRegistry.InvalidMakerSignature.selector, maker)
        );
        vm.prank(trader);
        registry.accept(quote, _order(), signature);
        vm.chainId(block.chainid - 1);

        FirmCommitmentRegistry otherRegistry = new FirmCommitmentRegistry(
            address(vault),
            address(weth),
            address(usdc),
            address(this),
            MAX_QUOTE_TTL
        );
        otherRegistry.setExecutor(address(executor));
        vm.expectRevert(
            abi.encodeWithSelector(FirmCommitmentRegistry.InvalidMakerSignature.selector, maker)
        );
        vm.prank(trader);
        otherRegistry.accept(quote, _order(), signature);
    }

    function testExpiredCommitmentCannotExecute() public {
        (bytes32 commitmentId, FirmQuote memory quote) = _accept(30);
        vm.warp(uint256(quote.expiry) + 1);

        vm.expectRevert(abi.encodeWithSelector(FirmExecutor.CommitmentExpired.selector, quote.expiry));
        vm.prank(trader);
        executor.execute(commitmentId, _order());
    }

    function testBondPathStillAttestsCommittedSwapVMOrder() public {
        (bytes32 commitmentId, FirmQuote memory quote) = _accept(31);
        vm.prank(maker);
        usdc.approve(address(aqua), 0);

        ISwapVM.Order memory alteredOrder = _order();
        alteredOrder.data = bytes.concat(alteredOrder.data, hex"00");
        bytes32 alteredHash = router.hash(alteredOrder);
        vm.expectRevert(
            abi.encodeWithSelector(FirmExecutor.OrderHashMismatch.selector, quote.orderHash, alteredHash)
        );
        vm.prank(trader);
        executor.execute(commitmentId, alteredOrder);
    }

    function testAcceptanceRejectsOrderWithoutExactFirmProgram() public {
        ISwapVM.Order memory invalidOrder = _orderWithProgram(hex"00");
        FirmQuote memory quote = _quoteForOrder(32, invalidOrder);
        bytes memory signature = _sign(quote);
        vm.expectRevert(FirmExecutor.InvalidFirmOrder.selector);
        vm.prank(trader);
        registry.accept(quote, invalidOrder, signature);
    }

    function testPremiumAndTtlPolicyAreEnforcedOnchain() public {
        FirmQuote memory wrongPremium = _quote(40);
        wrongPremium.premiumAmount = PREMIUM - 1;
        bytes memory wrongPremiumSignature = _sign(wrongPremium);
        vm.expectRevert(
            abi.encodeWithSelector(
                FirmCommitmentRegistry.PremiumMismatch.selector,
                PREMIUM,
                PREMIUM - 1
            )
        );
        vm.prank(trader);
        registry.accept(wrongPremium, _order(), wrongPremiumSignature);

        FirmQuote memory ttlTooLong = _quote(41);
        ttlTooLong.expiry = uint64(block.timestamp) + MAX_QUOTE_TTL + 1;
        bytes memory ttlTooLongSignature = _sign(ttlTooLong);
        vm.expectRevert(
            abi.encodeWithSelector(
                FirmCommitmentRegistry.QuoteTtlTooLong.selector,
                ttlTooLong.expiry,
                uint64(block.timestamp) + MAX_QUOTE_TTL
            )
        );
        vm.prank(trader);
        registry.accept(ttlTooLong, _order(), ttlTooLongSignature);

        FirmQuote memory lifetimeTooLong = _quote(98);
        lifetimeTooLong.pricingTtl = 29;
        lifetimeTooLong.premiumAmount = registry.quotePremium(lifetimeTooLong).premiumIn;
        bytes memory lifetimeSignature = _sign(lifetimeTooLong);
        vm.expectRevert(
            abi.encodeWithSelector(
                FirmCommitmentRegistry.QuoteLifetimeExceedsPricingTtl.selector,
                30,
                29
            )
        );
        vm.prank(trader);
        registry.accept(lifetimeTooLong, _order(), lifetimeSignature);
    }

    function testSignedPricingTtlSurvivesMiningDelay() public {
        FirmQuote memory quote = _quote(99);
        quote.sigmaWad = 800_000_000_000_000_000;
        quote.annualCapitalRateWad = 100_000_000_000_000_000;
        quote.capacityKBps = 10;
        quote.premiumAmount = registry.quotePremium(quote).premiumIn;
        uint256 signedPremium = quote.premiumAmount;
        bytes memory signature = _sign(quote);

        vm.warp(block.timestamp + 5);
        assertEq(registry.quotePremium(quote).premiumIn, signedPremium);
        vm.prank(trader);
        bytes32 commitmentId = registry.accept(quote, _order(), signature);

        Commitment memory accepted = registry.getCommitment(commitmentId);
        assertEq(accepted.quote.pricingTtl, 30);
        assertEq(accepted.quote.premiumAmount, signedPremium);
    }

    function testAcceptanceRejectsExpiryBeyondNativeDeadlineWidth() public {
        FirmQuote memory quote = _quote(101);
        quote.expiry = uint64(type(uint40).max) + 1;
        bytes memory signature = _sign(quote);

        vm.expectRevert(
            abi.encodeWithSelector(FirmCommitmentRegistry.ExpiryTooLarge.selector, quote.expiry)
        );
        vm.prank(trader);
        registry.accept(quote, _order(), signature);
    }

    function testNativeDeadlineAcceptsUint40MaximumWithoutTruncation() public {
        vm.warp(uint256(type(uint40).max) - 30);
        FirmQuote memory quote = _quote(102);
        quote.pricingTtl = 60;
        quote.premiumAmount = registry.quotePremium(quote).premiumIn;
        bytes memory signature = _sign(quote);

        vm.prank(trader);
        bytes32 commitmentId = registry.accept(quote, _order(), signature);
        Commitment memory accepted = registry.getCommitment(commitmentId);
        bytes memory takerTraits = executor.buildTakerTraits(commitmentId);
        uint40 nativeDeadline;
        assembly ("memory-safe") {
            nativeDeadline := shr(216, mload(add(takerTraits, 106)))
        }

        assertEq(accepted.quote.expiry, type(uint40).max);
        assertEq(accepted.quote.pricingTtl, 60);
        assertEq(nativeDeadline, accepted.quote.expiry);
    }

    function testNativeDeadlineAcceptsUint40MaximumMinusOneWithoutTruncation() public {
        vm.warp(uint256(type(uint40).max) - 31);
        FirmQuote memory quote = _quote(103);
        bytes memory signature = _sign(quote);

        vm.prank(trader);
        bytes32 commitmentId = registry.accept(quote, _order(), signature);
        bytes memory takerTraits = executor.buildTakerTraits(commitmentId);
        uint40 nativeDeadline;
        assembly ("memory-safe") {
            nativeDeadline := shr(216, mload(add(takerTraits, 106)))
        }

        assertEq(quote.expiry, uint64(type(uint40).max) - 1);
        assertEq(nativeDeadline, quote.expiry);
    }

    function testPricingSnapshotTermsAreEnforcedOnchain() public {
        FirmQuote memory wrongVersion = _quote(45);
        wrongVersion.pricingVersion = 3;
        bytes memory wrongVersionSignature = _sign(wrongVersion);
        vm.expectRevert(
            abi.encodeWithSelector(FirmCommitmentRegistry.UnsupportedPricingVersion.selector, uint32(3))
        );
        vm.prank(trader);
        registry.accept(wrongVersion, _order(), wrongVersionSignature);

        FirmQuote memory wrongToken = _quote(46);
        wrongToken.premiumToken = address(usdc);
        bytes memory wrongTokenSignature = _sign(wrongToken);
        vm.expectRevert(
            abi.encodeWithSelector(
                FirmCommitmentRegistry.UnsupportedPremiumToken.selector,
                address(weth),
                address(usdc)
            )
        );
        vm.prank(trader);
        registry.accept(wrongToken, _order(), wrongTokenSignature);

        FirmQuote memory wrongUtilization = _quote(47);
        wrongUtilization.utilizationAfterWad += 1;
        bytes memory wrongUtilizationSignature = _sign(wrongUtilization);
        vm.expectRevert(
            abi.encodeWithSelector(
                FirmCommitmentRegistry.UtilizationMismatch.selector,
                UTILIZATION_AFTER_WAD,
                UTILIZATION_AFTER_WAD + 1
            )
        );
        vm.prank(trader);
        registry.accept(wrongUtilization, _order(), wrongUtilizationSignature);
    }

    function testAcceptanceEscrowsPremiumInTokenIn() public {
        uint256 traderBefore = weth.balanceOf(trader);
        _accept(48);

        assertEq(weth.balanceOf(trader), traderBefore - PREMIUM);
        assertEq(weth.balanceOf(address(registry)), PREMIUM);
        assertEq(usdc.balanceOf(address(registry)), 0);
    }

    function testFuzzVaultConservesLiabilities(uint96 rawDeposit, uint96 rawWithdrawal) public {
        address anotherMaker = makeAddr("anotherMaker");
        uint256 depositAmount = bound(uint256(rawDeposit), 1, 1_000_000e6);
        uint256 withdrawal = bound(uint256(rawWithdrawal), 0, depositAmount);
        usdc.mint(anotherMaker, depositAmount);

        vm.startPrank(anotherMaker);
        usdc.approve(address(vault), depositAmount);
        vault.deposit(depositAmount);
        if (withdrawal != 0) vault.withdraw(withdrawal, anotherMaker);
        vm.stopPrank();

        assertEq(vault.liabilities(), usdc.balanceOf(address(vault)));
        assertEq(vault.availableOf(anotherMaker), depositAmount - withdrawal);
    }

    function testWithdrawalRevertsUnlessBondTokenMovesExactly() public {
        uint256 makerAvailableBefore = vault.availableOf(maker);
        uint256 vaultBalanceBefore = usdc.balanceOf(address(vault));
        usdc.setTransferSkips(true);

        vm.expectRevert(BondVault.DeflationaryTokenUnsupported.selector);
        vm.prank(maker);
        vault.withdraw(1e6, maker);

        assertEq(vault.availableOf(maker), makerAvailableBefore);
        assertEq(vault.liabilities(), vaultBalanceBefore);
        assertEq(usdc.balanceOf(address(vault)), vaultBalanceBefore);
    }

    function _accept(uint256 nonce) private returns (bytes32 commitmentId, FirmQuote memory quote) {
        quote = _quote(nonce);
        bytes memory signature = _sign(quote);
        vm.prank(trader);
        commitmentId = registry.accept(quote, _order(), signature);
    }

    function _assertFailedExecutionState(
        bytes32 commitmentId,
        uint256 traderWeth,
        uint256 traderUsdc,
        uint256 makerWeth,
        uint256 makerUsdc
    ) private view {
        assertEq(uint8(registry.getCommitment(commitmentId).status), uint8(CommitmentStatus.ACCEPTED));
        assertEq(vault.lockedOf(maker), MIN_OUT);
        assertEq(weth.balanceOf(trader), traderWeth);
        assertEq(usdc.balanceOf(trader), traderUsdc);
        assertEq(weth.balanceOf(maker), makerWeth);
        assertEq(usdc.balanceOf(maker), makerUsdc);
        assertEq(weth.balanceOf(address(executor)), 0);
        assertEq(weth.balanceOf(address(router)), 0);
    }

    function _quote(uint256 nonce) private view returns (FirmQuote memory) {
        return _quoteForOrder(nonce, _order());
    }

    function _quoteForOrder(uint256 nonce, ISwapVM.Order memory order) private view returns (FirmQuote memory) {
        return FirmQuote({
            maker: maker,
            taker: trader,
            executor: address(executor),
            swapRouter: address(router),
            orderHash: router.hash(order),
            tokenIn: address(weth),
            tokenOut: address(usdc),
            amountIn: AMOUNT_IN,
            referenceAmountOut: MIN_OUT,
            minAmountOut: MIN_OUT,
            requiredBond: MIN_OUT,
            premiumToken: address(weth),
            premiumAmount: PREMIUM,
            pricingVersion: 2,
            sigmaWad: 0,
            annualCapitalRateWad: 0,
            capacityKBps: 0,
            utilizationAfterWad: UTILIZATION_AFTER_WAD,
            minPremiumOut: MIN_PREMIUM_OUT,
            pricingTtl: 30,
            expiry: uint64(block.timestamp + 30),
            nonce: nonce
        });
    }

    function _sign(FirmQuote memory quote) private view returns (bytes memory) {
        bytes32 digest = registry.quoteDigest(quote);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _order() private view returns (ISwapVM.Order memory) {
        return _orderWithProgram(hex"52002100");
    }

    function _orderWithProgram(bytes memory program) private view returns (ISwapVM.Order memory) {
        return _orderWithTokensAndProgram(address(weth), address(usdc), program);
    }

    function _orderWithTokens(address firstToken, address secondToken) private view returns (ISwapVM.Order memory) {
        return _orderWithTokensAndProgram(firstToken, secondToken, hex"52002100");
    }

    function _orderWithTokensAndProgram(address firstToken, address secondToken, bytes memory program)
        private
        view
        returns (ISwapVM.Order memory)
    {
        (address tokenA, address tokenB) = firstToken < secondToken
            ? (firstToken, secondToken)
            : (secondToken, firstToken);
        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            receiver: maker,
            tokenA: tokenA,
            tokenB: tokenB,
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: true,
            allowZeroAmountIn: false,
            hasPreTransferInHook: false,
            hasPostTransferInHook: false,
            hasPreTransferOutHook: false,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: program
        }));
    }

    function _softOrder(uint64 salt) private view returns (ISwapVM.Order memory) {
        (address tokenA, address tokenB) = address(weth) < address(usdc)
            ? (address(weth), address(usdc))
            : (address(usdc), address(weth));
        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            receiver: maker,
            tokenA: tokenA,
            tokenB: tokenB,
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: true,
            allowZeroAmountIn: false,
            hasPreTransferInHook: false,
            hasPostTransferInHook: false,
            hasPreTransferOutHook: false,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: abi.encodePacked(bytes2(0x5000), bytes2(0x0208), salt)
        }));
    }

    function _softTakerTraits() private view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(this),
            isExactIn: true,
            shouldUnwrapWeth: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: true,
            useTransferFromAndAquaPush: true,
            isAToB: address(weth) < address(usdc),
            allowPartialFill: false,
            threshold: "",
            to: address(this),
            deadline: 0,
            hasPreTransferInCallback: false,
            hasPreTransferOutCallback: false,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: "",
            signature: ""
        }));
    }

    function _firmQuoteTakerTraits(uint256 amountOut, bytes32 commitmentId) private view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(this),
            isExactIn: true,
            shouldUnwrapWeth: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: true,
            useTransferFromAndAquaPush: true,
            isAToB: address(weth) < address(usdc),
            allowPartialFill: false,
            threshold: abi.encode(amountOut),
            to: address(this),
            deadline: 0,
            hasPreTransferInCallback: false,
            hasPreTransferOutCallback: false,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: abi.encodePacked(amountOut, commitmentId),
            signature: ""
        }));
    }

    function _runtimeTraits(
        uint256 threshold,
        uint40 deadline,
        bytes memory instructionArgs
    ) private view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(executor),
            isExactIn: true,
            shouldUnwrapWeth: false,
            isStrictThresholdAmount: true,
            isFirstTransferFromTaker: true,
            useTransferFromAndAquaPush: true,
            isAToB: address(weth) < address(usdc),
            allowPartialFill: false,
            threshold: abi.encode(threshold),
            to: trader,
            deadline: deadline,
            hasPreTransferInCallback: false,
            hasPreTransferOutCallback: false,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: instructionArgs,
            signature: ""
        }));
    }

    function _shipStrategy() private {
        ISwapVM.Order memory order = _order();
        _shipOrder(order, AQUA_OUTPUT);
    }

    function _shipOrder(ISwapVM.Order memory order, uint256 outputBalance) private {
        address[] memory tokens = new address[](2);
        uint256[] memory balances = new uint256[](2);
        tokens[0] = address(weth);
        tokens[1] = address(usdc);
        balances[0] = 0;
        balances[1] = outputBalance;

        vm.prank(maker);
        bytes32 strategyHash = aqua.ship(address(router), abi.encode(order), tokens, balances);
        assertEq(strategyHash, router.hash(order));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";

import { BondVault } from "../contracts/BondVault.sol";
import { FirmAquaSwapVMRouter } from "../contracts/FirmAquaSwapVMRouter.sol";
import { FirmCommitmentRegistry } from "../contracts/FirmCommitmentRegistry.sol";
import { FirmExecutor } from "../contracts/FirmExecutor.sol";
import { FirmGuard } from "../contracts/instructions/FirmGuard.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { Commitment, CommitmentStatus, FirmQuote } from "../contracts/types/FirmTypes.sol";

contract FirmDepthTest is Test {
    uint256 private constant MAKER_KEY = 0xA11CE;
    uint256 private constant TRADER_KEY = 0xB0B;
    uint256 private constant AMOUNT_IN = 0.25 ether;
    uint256 private constant MIN_OUT = 625e6;
    uint256 private constant PREMIUM = 2_500_000;
    uint256 private constant BOND_DEPOSIT = 2_000e6;
    uint256 private constant AQUA_OUTPUT = 5_000e6;

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
        registry = new FirmCommitmentRegistry(address(vault), address(weth), address(usdc), address(this));
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

        vm.prank(trader);
        usdc.approve(address(registry), type(uint256).max);
        vm.prank(trader);
        weth.approve(address(executor), type(uint256).max);

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
        assertEq(weth.balanceOf(maker), makerWethBefore + AMOUNT_IN);
        assertEq(usdc.balanceOf(maker), makerUsdcBefore - MIN_OUT + PREMIUM);
        assertEq(vault.availableOf(maker), BOND_DEPOSIT);
        assertEq(vault.lockedOf(maker), 0);

        Commitment memory settled = registry.getCommitment(commitmentId);
        assertEq(uint8(settled.status), uint8(CommitmentStatus.FILLED_AQUA));

        (uint248 virtualWeth,) = aqua.rawBalances(maker, address(router), settled.quote.orderHash, address(weth));
        (uint248 virtualUsdc,) = aqua.rawBalances(maker, address(router), settled.quote.orderHash, address(usdc));
        assertEq(uint256(virtualWeth), AMOUNT_IN);
        assertEq(uint256(virtualUsdc), AQUA_OUTPUT - MIN_OUT);
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
        assertEq(usdc.balanceOf(trader), traderUsdcBefore + MIN_OUT + PREMIUM);
        assertEq(weth.balanceOf(maker), makerWethBefore + AMOUNT_IN);
        assertEq(vault.availableOf(maker), BOND_DEPOSIT - MIN_OUT);
        assertEq(vault.lockedOf(maker), 0);
        assertEq(vault.liabilities(), BOND_DEPOSIT - MIN_OUT);

        Commitment memory settled = registry.getCommitment(commitmentId);
        assertEq(uint8(settled.status), uint8(CommitmentStatus.FILLED_BOND));
    }

    function testGuardRejectsQuoteFromAnyoneExceptSignedExecutor() public {
        (bytes32 commitmentId,) = _accept(3);
        bytes memory takerTraits = executor.buildTakerTraits(commitmentId);

        vm.expectRevert(
            abi.encodeWithSelector(FirmGuard.ExecutorMismatch.selector, address(executor), address(this))
        );
        router.quote(_order(), AMOUNT_IN, takerTraits);
    }

    function testReplayAndDoubleSettlementAreRejected() public {
        (bytes32 commitmentId, FirmQuote memory quote) = _accept(4);
        bytes memory signature = _sign(quote);

        vm.expectRevert(
            abi.encodeWithSelector(FirmCommitmentRegistry.NonceAlreadyUsed.selector, maker, quote.nonce)
        );
        vm.prank(trader);
        registry.accept(quote, signature);

        vm.prank(trader);
        executor.execute(commitmentId, _order());

        vm.expectRevert();
        vm.prank(trader);
        executor.execute(commitmentId, _order());
    }

    function testExpiryReturnsBondAndPaysPremiumToMaker() public {
        (bytes32 commitmentId, FirmQuote memory quote) = _accept(5);
        uint256 makerBefore = usdc.balanceOf(maker);
        vm.warp(uint256(quote.expiry) + 1);

        registry.expire(commitmentId);

        assertEq(vault.availableOf(maker), BOND_DEPOSIT);
        assertEq(usdc.balanceOf(maker), makerBefore + PREMIUM);
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
        registry.accept(cancelled, cancelledSignature);

        FirmQuote memory belowFloor = _quote(20);
        bytes memory belowFloorSignature = _sign(belowFloor);
        vm.prank(maker);
        registry.raiseMinimumValidNonce(21);

        vm.expectRevert(
            abi.encodeWithSelector(FirmCommitmentRegistry.NonceBelowMinimum.selector, maker, 20, 21)
        );
        vm.prank(trader);
        registry.accept(belowFloor, belowFloorSignature);
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

    function _accept(uint256 nonce) private returns (bytes32 commitmentId, FirmQuote memory quote) {
        quote = _quote(nonce);
        bytes memory signature = _sign(quote);
        vm.prank(trader);
        commitmentId = registry.accept(quote, signature);
    }

    function _quote(uint256 nonce) private view returns (FirmQuote memory) {
        return FirmQuote({
            maker: maker,
            trader: trader,
            executor: address(executor),
            orderHash: router.hash(_order()),
            tokenIn: address(weth),
            tokenOut: address(usdc),
            amountIn: AMOUNT_IN,
            minOut: MIN_OUT,
            premium: PREMIUM,
            requiredBond: MIN_OUT,
            expiry: uint64(block.timestamp + 1 days),
            nonce: nonce,
            chainId: block.chainid
        });
    }

    function _sign(FirmQuote memory quote) private view returns (bytes memory) {
        bytes32 digest = registry.quoteDigest(quote);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _order() private view returns (ISwapVM.Order memory) {
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
            program: hex"52002100"
        }));
    }

    function _shipStrategy() private {
        ISwapVM.Order memory order = _order();
        address[] memory tokens = new address[](2);
        uint256[] memory balances = new uint256[](2);
        tokens[0] = address(weth);
        tokens[1] = address(usdc);
        balances[0] = 0;
        balances[1] = AQUA_OUTPUT;

        vm.prank(maker);
        bytes32 strategyHash = aqua.ship(address(router), abi.encode(order), tokens, balances);
        assertEq(strategyHash, router.hash(order));
    }
}

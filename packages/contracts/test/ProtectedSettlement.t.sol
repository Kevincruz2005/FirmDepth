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


import { ProtectedSettlement } from "../contracts/ProtectedSettlement.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract PayoutToken is ERC20 {
    address public blocked;
    constructor(string memory n, string memory s, uint8) ERC20(n,s) {}
    function mint(address to, uint256 n) external { _mint(to,n); }
    function decimals() public pure override returns (uint8) { return 6; }
    function blockRecipient(address r) external { blocked = r; }
    function transfer(address to, uint256 value) public override returns (bool) {
        require(to != blocked, "recipient blocked");
        return super.transfer(to, value);
    }
}
contract ProtectedSettlementTest is Test {
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
    PayoutToken private usdc;
    Aqua private aqua;
    BondVault private vault;
    FirmCommitmentRegistry private registry;
    FirmAquaSwapVMRouter private router;
    FirmExecutor private executor;

    function setUp() public {
        maker = vm.addr(MAKER_KEY);
        trader = vm.addr(TRADER_KEY);

        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        usdc = new PayoutToken("USD Coin", "USDC", 6);
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
        settlement = new ProtectedSettlement(address(registry), address(executor));
        vm.prank(trader); weth.approve(address(settlement), type(uint256).max);
    }


    ProtectedSettlement private settlement;
    address private alice = address(0x111);
    address private bob = address(0x222);
    function _plan(uint256 nonce) private returns (bytes32 id) {
        ProtectedSettlement.Payout[] memory payouts = new ProtectedSettlement.Payout[](2);
        payouts[0] = ProtectedSettlement.Payout(alice, 375e6);
        payouts[1] = ProtectedSettlement.Payout(bob, 250e6);
        vm.prank(trader);
        id = settlement.createPlan(nonce, AMOUNT_IN, PREMIUM * 2, uint64(block.timestamp + 120), payouts);
        vm.prank(trader); settlement.fundPlan(id);
    }
    function _accepted(uint256 nonce) private returns (bytes32 id, bytes32 cid) {
        id = _plan(nonce);
        FirmQuote memory q = _quote(nonce);
        q.taker = address(settlement);
        q.utilizationAfterWad = registry.utilizationAfter(maker,q.requiredBond);
        bytes memory signature = _sign(q);
        vm.prank(trader); cid = settlement.acceptPlan(id,q,_order(),signature);
    }
    function _execute(bytes32 id) private { vm.prank(trader); settlement.executePlan(id,_order()); }
    function _assertPaid(bytes32 id, bytes32 cid, CommitmentStatus status) private view {
        assertEq(usdc.balanceOf(alice),375e6); assertEq(usdc.balanceOf(bob),250e6);
        assertEq(uint8(registry.getCommitment(cid).status),uint8(status));
        assertEq(uint8(settlement.getPlan(id).state),uint8(ProtectedSettlement.State.SETTLED));
        assertEq(settlement.totalEscrow(),0); assertEq(weth.balanceOf(address(settlement)),0);
        assertEq(weth.allowance(address(settlement),address(executor)),0);
        assertEq(weth.allowance(address(settlement),address(registry)),0);
        assertEq(vault.totalLocked(),0);
    }
    function testProtectedAquaPaysExactRecipients() public {
        (bytes32 id,bytes32 cid)=_accepted(1); _execute(id); _assertPaid(id,cid,CommitmentStatus.FILLED_AQUA);
        assertEq(weth.balanceOf(trader),10 ether-AMOUNT_IN-PREMIUM);
    }
    function testProtectedBondPaysExactRecipients() public {
        (bytes32 id,bytes32 cid)=_accepted(1);
        uint256 balance = usdc.balanceOf(maker); vm.prank(maker); usdc.transfer(address(0xdead),balance);
        _execute(id); _assertPaid(id,cid,CommitmentStatus.FILLED_BOND);
    }
    function _rollback(bool bond) private {
        (bytes32 id,bytes32 cid)=_accepted(1);
        if(bond) { uint256 balance = usdc.balanceOf(maker); vm.prank(maker); usdc.transfer(address(0xdead),balance); }
        usdc.blockRecipient(bob);
        vm.expectRevert(); _execute(id);
        assertEq(usdc.balanceOf(alice),0); assertEq(usdc.balanceOf(bob),0);
        assertEq(uint8(registry.getCommitment(cid).status),uint8(CommitmentStatus.ACCEPTED));
        assertEq(vault.totalLocked(),MIN_OUT);
        assertEq(settlement.getPlan(id).escrow,AMOUNT_IN+PREMIUM);
        usdc.blockRecipient(address(0)); _execute(id);
    }
    function testLaterPayoutFailureRollsBackAqua() public { _rollback(false); }
    function testLaterPayoutFailureRollsBackBond() public { _rollback(true); }
    function testExpiryRefundRetainsPremium() public {
        (bytes32 id,bytes32 cid)=_accepted(1);
        vm.warp(block.timestamp+31);
        vm.prank(trader); settlement.refundPlan(id);
        assertEq(weth.balanceOf(trader),10 ether-PREMIUM);
        assertEq(weth.balanceOf(maker),PREMIUM);
        assertEq(uint8(registry.getCommitment(cid).status),uint8(CommitmentStatus.EXPIRED));
        assertEq(settlement.totalEscrow(),0);
    }
    function testExternallyFinalizedExpiryRefund() public {
        (bytes32 id,bytes32 cid)=_accepted(1); vm.warp(block.timestamp+31); registry.expire(cid);
        vm.prank(trader); settlement.refundPlan(id); assertEq(weth.balanceOf(trader),10 ether-PREMIUM);
    }
    function testRefundCannotCancelAcceptedBeforeExpiry() public {
        (bytes32 id,)=_accepted(1); vm.expectRevert(ProtectedSettlement.NotExpired.selector);
        vm.prank(trader); settlement.refundPlan(id);
    }
    function testFundedCancellationAndReplay() public {
        bytes32 id=_plan(1); vm.prank(trader); settlement.refundPlan(id);
        assertEq(weth.balanceOf(trader),10 ether);
        vm.expectRevert(ProtectedSettlement.InvalidState.selector); vm.prank(trader); settlement.refundPlan(id);
    }
    function testUnauthorizedCalls() public {
        (bytes32 id,)=_accepted(1);
        vm.expectRevert(ProtectedSettlement.Unauthorized.selector); settlement.executePlan(id,_order());
        vm.expectRevert(ProtectedSettlement.Unauthorized.selector); settlement.refundPlan(id);
        vm.expectRevert(ProtectedSettlement.Unauthorized.selector); settlement.fundPlan(id);
    }
    function testExecutionCannotRepeat() public {
        (bytes32 id,)=_accepted(1); _execute(id);
        vm.expectRevert(ProtectedSettlement.InvalidState.selector); _execute(id);
    }
    function testFuzzCrossPlanIsolation(uint96 rawDonation) public {
        uint256 donation=bound(uint256(rawDonation),0,1 ether);
        (bytes32 a,)=_accepted(1); bytes32 b=_plan(2);
        weth.mint(address(settlement),donation); _execute(a);
        assertEq(weth.balanceOf(address(settlement)),settlement.getPlan(b).escrow+donation);
        vm.prank(trader); settlement.refundPlan(b);
        assertEq(settlement.totalEscrow(),0); assertEq(weth.balanceOf(address(settlement)),donation);
    }
    function testInputReentrancyCannotFund() public {
        ProtectedSettlement.Payout[] memory payouts=new ProtectedSettlement.Payout[](1);
        payouts[0]=ProtectedSettlement.Payout(alice,1);
        vm.prank(trader); bytes32 id=settlement.createPlan(1,AMOUNT_IN,0,uint64(block.timestamp+100),payouts);
        weth.setTransferFromCallback(address(settlement),abi.encodeCall(settlement.fundPlan,(id)));
        vm.expectRevert(); vm.prank(trader); settlement.fundPlan(id);
        assertEq(settlement.totalEscrow(),0);
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

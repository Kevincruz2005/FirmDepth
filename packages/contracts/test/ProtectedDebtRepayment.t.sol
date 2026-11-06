// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Aqua} from "@1inch/aqua/src/Aqua.sol";
import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import {MakerTraitsLib} from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import {BondVault} from "../contracts/BondVault.sol";
import {FirmAquaSwapVMRouter} from "../contracts/FirmAquaSwapVMRouter.sol";
import {FirmCommitmentRegistry} from "../contracts/FirmCommitmentRegistry.sol";
import {FirmExecutor} from "../contracts/FirmExecutor.sol";
import {MockERC20} from "../contracts/mocks/MockERC20.sol";
import {FirmQuote,CommitmentStatus} from "../contracts/types/FirmTypes.sol";
import {ProtectedSettlement} from "../contracts/ProtectedSettlement.sol";
import {ProtectedDebtRepayment} from "../contracts/ProtectedDebtRepayment.sol";
import {PayoutToken} from "./ProtectedSettlement.t.sol";

// Unit-test doubles only. Real Aave integration is verified by the separate fork demo.
contract RepaymentTestDebt is ERC20 {
    address public immutable POOL;
    address public immutable UNDERLYING_ASSET_ADDRESS;
    bool public frozenScaled;
    constructor(address pool,address asset) ERC20("Unit variable debt","unitDebt") {POOL=pool;UNDERLYING_ASSET_ADDRESS=asset;}
    function decimals() public pure override returns(uint8){return 6;}
    function mint(address user,uint256 amount) external {_mint(user,amount);}
    function burn(address user,uint256 amount) external {require(msg.sender==POOL);_burn(user,amount);}
    function setFrozenScaled(bool value) external {frozenScaled=value;}
    function scaledBalanceOf(address user) external view returns(uint256){return frozenScaled?1000e6:balanceOf(user);}
}
contract RepaymentTestPool {
    IERC20 public asset;
    RepaymentTestDebt public debt;
    address public aToken;
    uint8 public mode;
    bool public paused;
    bool public wrongReserve;
    bool public wrongRegisteredPool;
    address public callbackTarget;
    bytes public callbackData;
    constructor(address asset_){asset=IERC20(asset_);debt=new RepaymentTestDebt(address(this),asset_);aToken=address(new MockERC20("Unit aToken","unitA",6));}
    function ADDRESSES_PROVIDER() external view returns(address){return address(this);}
    function getPool() external view returns(address){return wrongRegisteredPool?address(0):address(this);}
    function getPoolDataProvider() external view returns(address){return address(this);}
    function getReserveTokensAddresses(address input) external view returns(address,address,address){return input==address(asset)&&!wrongReserve?(aToken,address(0),address(debt)):(address(0),address(0),address(0));}
    function getConfiguration(address) external view returns(uint256){return (uint256(6)<<48)|(uint256(1)<<56)|(paused?uint256(1)<<60:0);}
    function configure(uint8 m) external {mode=m;}
    function setPaused(bool value) external {paused=value;}
    function setWrongReserve(bool value) external {wrongReserve=value;}
    function setWrongPool(bool value) external {wrongRegisteredPool=value;}
    function callback(address target,bytes calldata data) external {callbackTarget=target;callbackData=data;}
    function repay(address input,uint256 amount,uint256 rate,address borrower) external returns(uint256 actual){
        require(input==address(asset)&&rate==2&&!paused,"unsupported repayment");
        require(mode!=1,"pool repayment failed");
        if(callbackTarget!=address(0)){(bool ok,)=callbackTarget.call(callbackData);require(ok,"repayment callback rejected");}
        actual=amount<debt.balanceOf(borrower)?amount:debt.balanceOf(borrower);
        if(mode==6)actual/=2;
        uint256 pull=mode==3?actual-1:mode==4?actual+1:actual;
        require(asset.transferFrom(msg.sender,aToken,pull));
        if(mode!=2)debt.burn(borrower,mode==7?actual+10:actual);
        if(mode==5)return actual+1;
    }
}

contract ProtectedDebtRepaymentTest is Test {
    uint256 constant MAKER_KEY=0xA11CE;
    uint256 constant INPUT=0.25 ether;
    uint256 constant PREMIUM=250_000_000_000_000;
    address maker;
    address payer;
    address borrower=address(0xB0770);
    MockERC20 weth;
    PayoutToken usdc;
    Aqua aqua;
    BondVault vault;
    FirmCommitmentRegistry registry;
    FirmAquaSwapVMRouter router;
    FirmExecutor executor;
    ProtectedSettlement settlement;
    ProtectedDebtRepayment repayment;
    RepaymentTestPool pool;
    RepaymentTestDebt debt;

    function setUp() public {
        maker=vm.addr(MAKER_KEY);payer=vm.addr(0xB0B);
        weth=new MockERC20("Wrapped Ether","WETH",18);usdc=new PayoutToken("USD Coin","USDC",6);aqua=new Aqua();
        vault=new BondVault(address(usdc),address(this));
        registry=new FirmCommitmentRegistry(address(vault),address(weth),address(usdc),address(this),300);
        router=new FirmAquaSwapVMRouter(address(aqua),address(weth),address(this),address(registry),address(vault));
        executor=new FirmExecutor(address(registry),address(aqua),address(router));
        vault.setRegistry(address(registry));registry.setExecutor(address(executor));
        settlement=new ProtectedSettlement(address(registry),address(executor));
        pool=new RepaymentTestPool(address(usdc));debt=pool.debt();
        repayment=new ProtectedDebtRepayment(address(settlement),address(pool),address(debt),block.chainid);
        weth.mint(payer,10 ether);usdc.mint(maker,10000e6);usdc.mint(payer,100e6);debt.mint(borrower,1000e6);
        vm.startPrank(maker);usdc.approve(address(vault),type(uint256).max);vault.deposit(2000e6);usdc.approve(address(aqua),type(uint256).max);vm.stopPrank();
        vm.prank(payer);weth.approve(address(repayment),type(uint256).max);
        address[] memory tokens=new address[](2);tokens[0]=address(weth);tokens[1]=address(usdc);
        uint256[] memory balances=new uint256[](2);balances[1]=5000e6;
        vm.prank(maker);aqua.ship(address(router),abi.encode(_order()),tokens,balances);
    }
    function _create(uint256 nonce,uint256 minimum) internal returns(bytes32 id){
        vm.prank(payer);id=repayment.createRepaymentPlan(nonce,borrower,address(usdc),2,INPUT,PREMIUM*2,uint64(block.timestamp+120),500e6,minimum);
    }
    function _fund(uint256 nonce) internal returns(bytes32 id){id=_create(nonce,1);vm.prank(payer);repayment.fundPlan(id);}
    function _quote(uint256 nonce) internal view returns(FirmQuote memory){
        return FirmQuote({maker:maker,taker:address(settlement),executor:address(executor),swapRouter:address(router),orderHash:router.hash(_order()),tokenIn:address(weth),tokenOut:address(usdc),amountIn:INPUT,referenceAmountOut:625e6,minAmountOut:625e6,requiredBond:625e6,premiumToken:address(weth),premiumAmount:PREMIUM,pricingVersion:2,sigmaWad:0,annualCapitalRateWad:0,capacityKBps:0,utilizationAfterWad:registry.utilizationAfter(maker,625e6),minPremiumOut:625000,pricingTtl:30,expiry:uint64(block.timestamp+30),nonce:nonce});
    }
    function _accept(bytes32 id,uint256 nonce) internal returns(bytes32 cid){FirmQuote memory q=_quote(nonce);(uint8 v,bytes32 r,bytes32 s)=vm.sign(MAKER_KEY,registry.quoteDigest(q));vm.prank(payer);return repayment.acceptPlan(id,q,_order(),abi.encodePacked(r,s,v));}
    function _accepted(uint256 nonce) internal returns(bytes32 id,bytes32 cid){id=_fund(nonce);cid=_accept(id,nonce);}
    function _execute(bytes32 id) internal {vm.prank(payer);repayment.executePlan(id,_order());}
    function _drain() internal {uint256 balance=usdc.balanceOf(maker);vm.prank(maker);usdc.transfer(address(0xdead),balance);}
    function _assertRollback(bytes32 id,bytes32 cid) internal view {
        assertEq(debt.balanceOf(borrower),1000e6);assertEq(usdc.balanceOf(pool.aToken()),0);
        assertEq(uint8(registry.getCommitment(cid).status),uint8(CommitmentStatus.ACCEPTED));
        assertEq(uint8(settlement.getPlan(id).state),uint8(ProtectedSettlement.State.ACCEPTED));
        assertEq(vault.totalLocked(),625e6);assertEq(weth.balanceOf(maker),0);
        assertEq(weth.balanceOf(address(repayment)),0);assertEq(usdc.balanceOf(address(repayment)),0);
    }
    function _assertSettled(bytes32 id,bytes32 cid,CommitmentStatus status) internal view {
        assertEq(debt.balanceOf(borrower),500e6);assertEq(usdc.balanceOf(pool.aToken()),500e6);assertEq(usdc.balanceOf(payer),225e6);
        assertEq(uint8(registry.getCommitment(cid).status),uint8(status));assertEq(vault.totalLocked(),0);assertEq(settlement.totalEscrow(),0);
        assertEq(weth.balanceOf(payer),10 ether-INPUT-PREMIUM);assertEq(weth.balanceOf(address(repayment)),0);assertEq(usdc.balanceOf(address(repayment)),0);
        assertEq(usdc.allowance(address(repayment),address(pool)),0);assertEq(weth.allowance(address(repayment),address(settlement)),0);
        (ProtectedDebtRepayment.RepaymentPlan memory p,ProtectedSettlement.Plan memory inner)=repayment.getRepaymentPlan(id);
        assertEq(p.actualRepaid,500e6);assertEq(p.commitmentId,cid);assertEq(inner.payer,address(repayment));assertEq(inner.escrow,0);
    }
    function testAquaRepaymentReusesSettlement() public {(bytes32 id,bytes32 cid)=_accepted(1);_execute(id);_assertSettled(id,cid,CommitmentStatus.FILLED_AQUA);}
    function testBondRepaymentAfterInventoryLoss() public {(bytes32 id,bytes32 cid)=_accepted(1);_drain();_execute(id);_assertSettled(id,cid,CommitmentStatus.FILLED_BOND);}
    function testProtocolPartialRepaymentReturnsAllUnspentUsdc() public {(bytes32 id,)=_accepted(1);pool.configure(6);_execute(id);assertEq(debt.balanceOf(borrower),750e6);assertEq(usdc.balanceOf(payer),475e6);}
    function testDebtShrinkingBeforeExecutionCapsRepaymentAndRefunds() public {(bytes32 id,)=_accepted(1);vm.prank(address(pool));debt.burn(borrower,900e6);_execute(id);assertEq(debt.balanceOf(borrower),0);assertEq(usdc.balanceOf(payer),625e6);}
    function testDebtIncreasingNeverExceedsAuthorizedCap() public {(bytes32 id,)=_accepted(1);debt.mint(borrower,500e6);_execute(id);assertEq(debt.balanceOf(borrower),1000e6);assertEq(usdc.balanceOf(pool.aToken()),500e6);}
    function testZeroDebtRollsBackSettlementAndCanExpire() public {(bytes32 id,bytes32 cid)=_accepted(1);vm.prank(address(pool));debt.burn(borrower,1000e6);vm.expectRevert(ProtectedDebtRepayment.DebtBelowMinimum.selector);_execute(id);assertEq(uint8(registry.getCommitment(cid).status),1);assertEq(vault.totalLocked(),625e6);vm.warp(block.timestamp+31);vm.prank(payer);repayment.refundPlan(id);assertEq(weth.balanceOf(payer),10 ether-PREMIUM);}
    function testMinimumRepaymentIsImmutableAndEnforced() public {bytes32 id=_create(1,500e6);vm.prank(payer);repayment.fundPlan(id);_accept(id,1);pool.configure(6);vm.expectRevert(ProtectedDebtRepayment.InvalidDebtReduction.selector);_execute(id);}
    function testInsufficientDebtAtAcceptanceDoesNotLockBond() public {bytes32 id=_fund(1);vm.prank(address(pool));debt.burn(borrower,1000e6);FirmQuote memory q=_quote(1);(uint8 v,bytes32 r,bytes32 s)=vm.sign(MAKER_KEY,registry.quoteDigest(q));vm.expectRevert(ProtectedDebtRepayment.DebtBelowMinimum.selector);vm.prank(payer);repayment.acceptPlan(id,q,_order(),abi.encodePacked(r,s,v));assertEq(vault.totalLocked(),0);}
    function testPoolFailureRollsBackAqua() public {(bytes32 id,bytes32 cid)=_accepted(1);pool.configure(1);vm.expectRevert();_execute(id);_assertRollback(id,cid);pool.configure(0);_execute(id);}
    function testPoolFailureRollsBackBond() public {(bytes32 id,bytes32 cid)=_accepted(1);_drain();pool.configure(1);vm.expectRevert();_execute(id);_assertRollback(id,cid);}
    function testLaterRefundFailureRollsBackAaveAndAqua() public {(bytes32 id,bytes32 cid)=_accepted(1);usdc.blockRecipient(payer);vm.expectRevert();_execute(id);_assertRollback(id,cid);usdc.blockRecipient(address(0));_execute(id);_assertSettled(id,cid,CommitmentStatus.FILLED_AQUA);}
    function testLaterRefundFailureRollsBackAaveAndBond() public {(bytes32 id,bytes32 cid)=_accepted(1);_drain();usdc.blockRecipient(payer);vm.expectRevert();_execute(id);_assertRollback(id,cid);}
    function testReturnedAmountWithoutDebtBurnRejected() public {(bytes32 id,bytes32 cid)=_accepted(1);pool.configure(2);vm.expectRevert(ProtectedDebtRepayment.InvalidDebtReduction.selector);_execute(id);_assertRollback(id,cid);}
    function testInexactPoolTokenPullRejected() public {(bytes32 id,bytes32 cid)=_accepted(1);pool.configure(3);vm.expectRevert(ProtectedDebtRepayment.InexactTransfer.selector);_execute(id);_assertRollback(id,cid);}
    function testPoolCannotPullBeyondBoundedApproval() public {(bytes32 id,bytes32 cid)=_accepted(1);pool.configure(4);vm.expectRevert();_execute(id);_assertRollback(id,cid);}
    function testFalseRepaymentReturnRejected() public {(bytes32 id,bytes32 cid)=_accepted(1);pool.configure(5);vm.expectRevert(ProtectedDebtRepayment.InvalidDebtReduction.selector);_execute(id);_assertRollback(id,cid);}
    function testExcessDebtReductionBeyondRoundingRejected() public {(bytes32 id,bytes32 cid)=_accepted(1);pool.configure(7);vm.expectRevert(ProtectedDebtRepayment.InvalidDebtReduction.selector);_execute(id);_assertRollback(id,cid);}
    function testScaledDebtMustActuallyDecrease() public {(bytes32 id,bytes32 cid)=_accepted(1);debt.setFrozenScaled(true);vm.expectRevert(ProtectedDebtRepayment.InvalidDebtReduction.selector);_execute(id);_assertRollback(id,cid);}
    function testRepaymentCallbackCannotReenter() public {(bytes32 id,bytes32 cid)=_accepted(1);pool.callback(address(repayment),abi.encodeCall(repayment.executePlan,(id,_order())));vm.expectRevert();_execute(id);_assertRollback(id,cid);}
    function testFundingCallbackCannotReenter() public {bytes32 id=_create(1,1);weth.setTransferFromCallback(address(repayment),abi.encodeCall(repayment.fundPlan,(id)));vm.expectRevert();vm.prank(payer);repayment.fundPlan(id);assertEq(settlement.totalEscrow(),0);assertEq(weth.balanceOf(payer),10 ether);}
    function testUnauthorizedFundAcceptExecuteAndRefundRejected() public {(bytes32 id,)=_accepted(1);vm.expectRevert(ProtectedDebtRepayment.Unauthorized.selector);repayment.fundPlan(id);FirmQuote memory q=_quote(2);vm.expectRevert(ProtectedDebtRepayment.Unauthorized.selector);repayment.acceptPlan(id,q,_order(),"");vm.expectRevert(ProtectedDebtRepayment.Unauthorized.selector);repayment.executePlan(id,_order());vm.expectRevert(ProtectedDebtRepayment.Unauthorized.selector);repayment.refundPlan(id);}
    function testUnderlyingPlanCannotBeExecutedOrRefundedDirectlyByPayer() public {(bytes32 id,)=_accepted(1);vm.expectRevert(ProtectedSettlement.Unauthorized.selector);vm.prank(payer);settlement.executePlan(id,_order());vm.expectRevert(ProtectedSettlement.Unauthorized.selector);vm.prank(payer);settlement.refundPlan(id);}
    function testDuplicateRepaymentAndDuplicateNonceRejected() public {(bytes32 id,)=_accepted(1);_execute(id);vm.expectRevert(ProtectedDebtRepayment.InvalidRepayment.selector);_execute(id);vm.expectRevert(ProtectedDebtRepayment.InvalidRepayment.selector);_create(1,1);}
    function testWrongTakerQuoteRejected() public {bytes32 id=_fund(1);FirmQuote memory q=_quote(1);q.taker=address(repayment);(uint8 v,bytes32 r,bytes32 s)=vm.sign(MAKER_KEY,registry.quoteDigest(q));vm.expectRevert(ProtectedSettlement.InvalidQuote.selector);vm.prank(payer);repayment.acceptPlan(id,q,_order(),abi.encodePacked(r,s,v));}
    function testCommitmentCannotBindTwoPlans() public {bytes32 id=_fund(1);bytes32 other=_fund(2);FirmQuote memory q=_quote(1);(uint8 v,bytes32 r,bytes32 s)=vm.sign(MAKER_KEY,registry.quoteDigest(q));vm.prank(payer);repayment.acceptPlan(id,q,_order(),abi.encodePacked(r,s,v));vm.expectRevert();vm.prank(payer);repayment.acceptPlan(other,q,_order(),abi.encodePacked(r,s,v));}
    function testWrongDebtModeAndWrongAssetRejected() public {vm.expectRevert(ProtectedDebtRepayment.InvalidRepayment.selector);vm.prank(payer);repayment.createRepaymentPlan(1,borrower,address(usdc),1,INPUT,PREMIUM,uint64(block.timestamp+120),500e6,1);vm.expectRevert(ProtectedDebtRepayment.InvalidRepayment.selector);vm.prank(payer);repayment.createRepaymentPlan(1,borrower,address(weth),2,INPUT,PREMIUM,uint64(block.timestamp+120),500e6,1);}
    function testInvalidMinimumAndBorrowerRejected() public {vm.expectRevert(ProtectedDebtRepayment.InvalidRepayment.selector);vm.prank(payer);repayment.createRepaymentPlan(1,address(0),address(usdc),2,INPUT,PREMIUM,uint64(block.timestamp+120),500e6,1);vm.expectRevert(ProtectedDebtRepayment.InvalidRepayment.selector);vm.prank(payer);repayment.createRepaymentPlan(1,borrower,address(usdc),2,INPUT,PREMIUM,uint64(block.timestamp+120),500e6,0);}
    function testExpiredPlanCannotBeFunded() public {bytes32 id=_create(1,1);vm.warp(block.timestamp+121);vm.expectRevert(ProtectedSettlement.InvalidState.selector);vm.prank(payer);repayment.fundPlan(id);assertEq(weth.balanceOf(payer),10 ether);}
    function testAcceptedExpiryReturnsPrincipalAndRetainsPremium() public {(bytes32 id,bytes32 cid)=_accepted(1);vm.expectRevert(ProtectedSettlement.NotExpired.selector);vm.prank(payer);repayment.refundPlan(id);vm.warp(block.timestamp+31);vm.prank(payer);repayment.refundPlan(id);assertEq(weth.balanceOf(payer),10 ether-PREMIUM);assertEq(weth.balanceOf(maker),PREMIUM);assertEq(uint8(registry.getCommitment(cid).status),4);assertEq(debt.balanceOf(borrower),1000e6);}
    function testExternalExpiryAndOwnerOnlyRefund() public {(bytes32 id,bytes32 cid)=_accepted(1);vm.warp(block.timestamp+31);registry.expire(cid);vm.prank(payer);repayment.refundPlan(id);assertEq(weth.balanceOf(payer),10 ether-PREMIUM);vm.expectRevert();vm.prank(payer);repayment.refundPlan(id);}
    function testUnacceptedCancellationReturnsFullBudget() public {bytes32 id=_fund(1);vm.prank(payer);repayment.refundPlan(id);assertEq(weth.balanceOf(payer),10 ether);assertEq(settlement.totalEscrow(),0);}
    function testCrossPlanEscrowIsolation() public {(bytes32 id,)=_accepted(1);bytes32 other=_fund(2);uint256 escrow=settlement.getPlan(other).escrow;_execute(id);assertEq(settlement.getPlan(other).escrow,escrow);assertEq(settlement.totalEscrow(),escrow);vm.prank(payer);repayment.refundPlan(other);assertEq(settlement.totalEscrow(),0);}
    function testDonationsCannotFundRepaymentOrBeSwept() public {(bytes32 id,)=_accepted(1);usdc.mint(address(repayment),77);weth.mint(address(repayment),88);_execute(id);assertEq(usdc.balanceOf(address(repayment)),77);assertEq(weth.balanceOf(address(repayment)),88);assertEq(usdc.balanceOf(payer),225e6);}
    function testReserveChangeAndPauseFailClosed() public {(bytes32 id,bytes32 cid)=_accepted(1);pool.setPaused(true);vm.expectRevert(ProtectedDebtRepayment.IncompatibleReserve.selector);_execute(id);pool.setPaused(false);pool.setWrongReserve(true);vm.expectRevert(ProtectedDebtRepayment.IncompatibleReserve.selector);_execute(id);pool.setWrongReserve(false);_assertRollback(id,cid);}
    function testWrongChainCannotReplayPlan() public {bytes32 id=_fund(1);vm.chainId(block.chainid+1);vm.expectRevert(ProtectedDebtRepayment.IncompatibleReserve.selector);vm.prank(payer);repayment.refundPlan(id);}
    function testIncompatibleDeploymentRejected() public {vm.expectRevert(ProtectedDebtRepayment.IncompatibleReserve.selector);new ProtectedDebtRepayment(address(settlement),address(pool),address(weth),block.chainid);pool.setWrongPool(true);vm.expectRevert(ProtectedDebtRepayment.IncompatibleReserve.selector);new ProtectedDebtRepayment(address(settlement),address(pool),address(debt),block.chainid);}
    function testArbitraryCallSurfaceDoesNotExist() public {(bool ok,)=address(repayment).call(abi.encodeWithSignature("execute(address,bytes)",address(pool),hex"00"));assertFalse(ok);}
    function _order() internal view returns(ISwapVM.Order memory){
        (address a,address b)=address(weth)<address(usdc)?(address(weth),address(usdc)):(address(usdc),address(weth));
        return MakerTraitsLib.build(MakerTraitsLib.Args({maker:maker,receiver:maker,tokenA:a,tokenB:b,shouldUnwrapWeth:false,useAquaInsteadOfSignature:true,allowZeroAmountIn:false,hasPreTransferInHook:false,hasPostTransferInHook:false,hasPreTransferOutHook:false,hasPostTransferOutHook:false,preTransferInTarget:address(0),preTransferInData:"",postTransferInTarget:address(0),postTransferInData:"",preTransferOutTarget:address(0),preTransferOutData:"",postTransferOutTarget:address(0),postTransferOutData:"",program:hex"52002100"}));
    }
}

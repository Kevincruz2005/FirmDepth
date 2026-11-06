import test from "node:test";
import assert from "node:assert/strict";
import {authenticateDebtRepayment,readBorrowerDebt,createDebtRepaymentPlan,getDebtRepaymentReceipt,aaveBaseMarket} from "../src/debt-repayment.js";
const address="0x1111111111111111111111111111111111111111" as const;
const other="0x2222222222222222222222222222222222222222" as const;
const id=`0x${"11".repeat(32)}` as const;
const expected={settlement:address,registry:address,executor:address,weth:aaveBaseMarket.weth,usdc:aaveBaseMarket.asset,firmRouter:address};
test("debt repayment rejects a different chain or substituted USDC",async()=>{
 await assert.rejects(authenticateDebtRepayment({getChainId:async()=>11155111} as never,address,expected),/verified Base/);
 await assert.rejects(authenticateDebtRepayment({getChainId:async()=>8453} as never,address,{...expected,usdc:other}),/verified Base/);
});
test("debt adapter cannot impersonate another settlement deployment",async()=>{
 const client={getChainId:async()=>8453,getBytecode:async()=>"0x1234",readContract:async()=>other};
 await assert.rejects(authenticateDebtRepayment(client as never,address,expected),/settlement mismatch/);
});
test("borrower debt observations pin nominal and scaled balances to the same block",async()=>{
 const seen:bigint[]=[];
 const client={getBlock:async()=>({number:12n}),readContract:async(request:{address:string;blockNumber:bigint;functionName:string;args:readonly string[]})=>{assert.equal(request.address,aaveBaseMarket.variableDebtToken);assert.equal(request.args[0],other);seen.push(request.blockNumber);return request.functionName==="balanceOf"?500n:450n;}};
 const debt=await readBorrowerDebt(client as never,other);
 assert.deepEqual(debt,{balance:500n,scaledBalance:450n,blockNumber:12n});assert.deepEqual(seen,[12n,12n]);
});
test("repayment creation simulates the fixed asset, mode, borrower and spending limits before submission",async()=>{
 let simulated=false;
 const request={marker:"simulated request"};
 const clients={account:other,publicClient:{simulateContract:async(input:{address:string;functionName:string;args:readonly unknown[]})=>{assert.equal(input.address,address);assert.equal(input.functionName,"createRepaymentPlan");assert.deepEqual(input.args,[9n,other,aaveBaseMarket.asset,2n,10n,2n,1000n,50n,1n]);simulated=true;return {request,result:id};}},walletClient:{writeContract:async(sent:unknown)=>{assert.ok(simulated);assert.equal(sent,request);return id;}}};
 const result=await createDebtRepaymentPlan(clients as never,address,{nonce:9n,borrower:other,amountIn:10n,maxPremium:2n,deadline:1000n,maxRepay:50n,minRepay:1n});assert.deepEqual(result,{hash:id,planId:id});
});
test("debt receipt rejects reverted execution rather than treating a payout as repayment",async()=>{
 const client={readContract:async({functionName}:{functionName:string})=>functionName==="getRepaymentPlan"?[{actualRepaid:1n},{state:4}]:address,getTransactionReceipt:async()=>({status:"reverted"})};
 await assert.rejects(getDebtRepaymentReceipt(client as never,address,id,id),/not successfully settled/);
});
test("debt receipt rejects a commitment belonging to a different underlying payer",async()=>{
 const client={readContract:async({functionName}:{functionName:string})=>functionName==="getRepaymentPlan"?[{actualRepaid:1n,commitmentId:id},{state:4,payer:other,commitmentId:id}]:address,getTransactionReceipt:async()=>({status:"success",logs:[]})};
 await assert.rejects(getDebtRepaymentReceipt(client as never,address,id,id),/commitment binding mismatch/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {authenticateSettlement,getPayoutReceipt} from "../src/settlement.js";
import {settlementAbi} from "../src/settlement-abi.js";
import {erc20Abi} from "../src/requests.js";
import {encodeAbiParameters,encodeEventTopics,getAbiItem,type Abi} from "viem";
const a="0x1111111111111111111111111111111111111111" as const;
const b="0x2222222222222222222222222222222222222222" as const;
const id=`0x${"11".repeat(32)}` as const;
test("settlement authentication rejects mismatched immutable executor",async()=>{
 const client={getBytecode:async()=>"0x1234",readContract:async({functionName}:{functionName:string})=>functionName==="executor"?b:a};
 await assert.rejects(authenticateSettlement(client as never,a,{registry:a,executor:a,weth:a,usdc:a,firmRouter:a}),/executor mismatch/);
});
test("settlement receipt refuses reverted transactions",async()=>{
 const client={readContract:async({functionName}:{functionName:string})=>functionName==="getPlan"?{state:4}:functionName==="getPayouts"?[]:a,getTransactionReceipt:async()=>({status:"reverted"})};
 await assert.rejects(getPayoutReceipt(client as never,a,id,id),/successfully settled/);
});
test("settlement receipt locates acceptance in its recorded block within bounded RPC limits",async()=>{
 const token="0x3333333333333333333333333333333333333333" as const;
 const event=(address:string,abi:Abi,eventName:string,args:Record<string,unknown>)=>{
  const item=getAbiItem({abi,name:eventName});if(item.type!=="event")throw Error("Expected event");
  const inputs=item.inputs.filter(input=>!input.indexed);
  return {address,topics:encodeEventTopics({abi,eventName,args:args as never}),data:encodeAbiParameters(inputs as never,inputs.map(input=>args[input.name!]) as never)};
 };
 const logs=[
  event(a,settlementAbi,"PlanSettled",{planId:id,commitmentId:id,status:2,proceeds:7n,surplus:0n,refund:1n}),
  event(a,settlementAbi,"RecipientPaid",{planId:id,index:0n,recipient:b,amount:7n}),
  event(token,erc20Abi,"Transfer",{from:b,to:a,value:7n}),
  event(token,erc20Abi,"Transfer",{from:a,to:b,value:7n}),
 ];
 let acceptedBlock=123n,queries=0;
 const client={
  readContract:async({functionName}:{functionName:string})=>{
   if(functionName==="getPlan")return {state:4,commitmentId:id,payer:b,totalOut:7n,maxPremium:2n,premiumPaid:1n};
   if(functionName==="getPayouts")return [{recipient:b,amount:7n}];
   if(functionName==="tokenOut")return token;
   if(functionName==="getCommitment")return {acceptedBlock};
   return b;
  },
  getTransactionReceipt:async()=>({status:"success",blockNumber:130n,logs}),
  getContractEvents:async(query:{fromBlock:bigint;toBlock:bigint})=>{
   queries++;assert.equal(query.fromBlock,123n);assert.equal(query.toBlock,123n);
   throw Error("Acceptance lookup reached");
  },
 };
 await assert.rejects(getPayoutReceipt(client as never,a,id,id,10n),/Acceptance lookup reached/);
 assert.equal(queries,1);
 acceptedBlock=9n;
 await assert.rejects(getPayoutReceipt(client as never,a,id,id,10n),/outside settlement history/);
 acceptedBlock=131n;
 await assert.rejects(getPayoutReceipt(client as never,a,id,id,10n),/outside settlement history/);
 assert.equal(queries,1);
});

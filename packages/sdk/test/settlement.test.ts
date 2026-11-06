import test from "node:test";
import assert from "node:assert/strict";
import {authenticateSettlement,getPayoutReceipt} from "../src/settlement.js";
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

import test from "node:test";
import assert from "node:assert/strict";
import {settlementQuote} from "../src/settlement.js";
const address="0x1111111111111111111111111111111111111111" as const;
const config={chainId:8453,settlement:address,addresses:{registry:address,executor:address,weth:address,usdc:address,firmRouter:address}};
test("settlement quote rejects client-selected payer and principal",async()=>{
 let signed=false;
 await assert.rejects(settlementQuote({} as never,{chainId:8453,settlement:address,planId:`0x${"11".repeat(32)}`,pricingTtl:120,payer:address},config,async()=>{signed=true;throw Error("must not sign");}));
 assert.equal(signed,false);
});
test("settlement quote rejects an unfunded plan before signing",async()=>{
 const client={getBytecode:async()=>"0x1234",getBlock:async()=>({timestamp:10n}),readContract:async({functionName}:{functionName:string})=>functionName==="getPlan"?{state:1,deadline:1000n}:address};
 let signed=false;
 await assert.rejects(settlementQuote(client as never,{chainId:8453,settlement:address,planId:`0x${"11".repeat(32)}`,pricingTtl:120},config,async()=>{signed=true;throw Error("must not sign");}),/funded/);
 assert.equal(signed,false);
});

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
test("a funded debt-adapter plan keeps the existing settlement as the signed taker",async()=>{
 const adapter="0x2222222222222222222222222222222222222222" as const;
 const client={getBytecode:async()=>"0x1234",getBlock:async()=>({timestamp:10n}),readContract:async({functionName}:{functionName:string})=>functionName==="getPlan"?{payer:adapter,state:2,deadline:1000n,amountIn:10n,totalOut:500n,maxPremium:2n}:address};
 let signed=false;
 const result=await settlementQuote(client as never,{chainId:8453,settlement:address,planId:`0x${"11".repeat(32)}`,pricingTtl:120},config,async(taker,input,ttl)=>{assert.equal(taker,address);assert.notEqual(taker,adapter);assert.equal(input,10n);assert.equal(ttl,120);signed=true;return {quote:{taker:address,amountIn:10n,minAmountOut:500n,premiumAmount:1n,expiry:130n},makerSignature:"0x",quotedAtBlock:1n} as never;});
 assert.ok(signed);assert.equal(result.quote.taker,address);
});
test("repayment quote requests cannot inject an external Pool or debt mode",async()=>{
 let signed=false;
 await assert.rejects(settlementQuote({} as never,{chainId:8453,settlement:address,planId:`0x${"11".repeat(32)}`,pricingTtl:120,pool:address,debtMode:1},config,async()=>{signed=true;throw Error("must not sign");}));
 assert.equal(signed,false);
});

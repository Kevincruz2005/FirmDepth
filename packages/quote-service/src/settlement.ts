import { readPlan, authenticateSettlement } from "@firmdepth/sdk/settlement";
import { getAddress, isHash, type Address, type PublicClient } from "viem";
import type { FirmQuoteEnvelope } from "@firmdepth/sdk/quote-provider";

export async function settlementQuote(client: PublicClient, request: unknown, config: {
  chainId: number; settlement: Address; addresses: {registry:Address;executor:Address;weth:Address;usdc:Address;firmRouter:Address};
}, quote: (taker:Address, amountIn:bigint, ttl:5|30|120)=>Promise<FirmQuoteEnvelope>) {
  if(!request || typeof request!=="object") throw new Error("Invalid settlement quote request");
  const body=request as Record<string,unknown>;
  if(Object.keys(body).sort().join(',')!=="chainId,planId,pricingTtl,settlement" || body.chainId!==config.chainId || typeof body.settlement!=="string" || getAddress(body.settlement)!==getAddress(config.settlement) || typeof body.planId!=="string" || !isHash(body.planId) || ![5,30,120].includes(Number(body.pricingTtl))) throw new Error("Invalid settlement quote request");
  await authenticateSettlement(client,config.settlement,config.addresses);
  const [plan,block]=await Promise.all([readPlan(client,config.settlement,body.planId),client.getBlock()]);
  if(plan.state!==2 || plan.deadline<=block.timestamp) throw new Error("Plan must be funded and unexpired");
  const result=await quote(config.settlement,plan.amountIn,Number(body.pricingTtl) as 5|30|120);
  if(result.quote.taker.toLowerCase()!==config.settlement.toLowerCase() || result.quote.amountIn!==plan.amountIn || result.quote.minAmountOut<plan.totalOut || result.quote.premiumAmount>plan.maxPremium || result.quote.expiry>plan.deadline) throw new Error("Quote does not satisfy immutable plan");
  return result;
}

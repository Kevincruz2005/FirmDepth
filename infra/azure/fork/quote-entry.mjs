import {randomBytes} from 'node:crypto';
import {createPublicClient,createWalletClient,http,getAddress,parseAbi,parseTransaction,recoverTransactionAddress} from 'viem';
import {buildFirmQuote} from '../../../packages/sdk/dist/quote.js';
import {firmQuoteTypedData} from '../../../packages/sdk/dist/eip712.js';
import {settlementQuote} from '../../../packages/quote-service/dist/settlement.js';

export async function inspectSignedTransaction(serializedTransaction){
 const tx=parseTransaction(serializedTransaction);
 return {chainId:tx.chainId,to:tx.to,sender:await recoverTransactionAddress({serializedTransaction})};
}

// The same fixed-price controlled fixture as the local demo. This is never a
// public-market quote service, and it has no real-chain key or broadcast path.
export async function hostedQuote(runtime,body,protectedPlan,rpcUrl){
 const client=createPublicClient({transport:http(rpcUrl)});
 const wallet=createWalletClient({transport:http(rpcUrl)});
 const strategy=runtime.strategies.find(s=>s.kind==='FIRM');
 const maker=getAddress(strategy.order.maker);
 const quote=async(taker,amountIn,ttl)=>{
  if(amountIn<=0n||amountIn>500_000_000_000_000_000n)throw Error('Amount exceeds the controlled demo limits');
  const block=await client.getBlock();const output=amountIn*2_000_000_000n/10n**18n;
  const requiredBond=output*120n/100n;
  const utilizationAfterWad=await client.readContract({address:runtime.addresses.registry,abi:parseAbi(['function utilizationAfter(address,uint256) view returns(uint256)']),functionName:'utilizationAfter',args:[maker,requiredBond]});
  const q=buildFirmQuote({maker,taker,executor:runtime.addresses.executor,swapRouter:runtime.addresses.firmRouter,orderHash:strategy.orderHash,tokenIn:runtime.addresses.weth,tokenOut:runtime.addresses.usdc,amountIn,referenceAmountOut:output,minAmountOut:output,requiredBond,premiumToken:runtime.addresses.weth,sigmaWad:800_000_000_000_000_000n,annualCapitalRateWad:100_000_000_000_000_000n,capacityKBps:10,utilizationAfterWad,minPremiumOut:1n,expiry:block.timestamp+BigInt(ttl),nonce:BigInt('0x'+randomBytes(32).toString('hex'))},block.timestamp);
  return {quote:q,makerSignature:await wallet.signTypedData({account:maker,...firmQuoteTypedData(runtime.addresses.registry,8453,q)}),quotedAtBlock:block.number};
 };
 if(protectedPlan)return settlementQuote(client,body,{chainId:8453,settlement:runtime.settlement.address,addresses:runtime.addresses},quote);
 if(!body||Object.keys(body).sort().join(',')!=='amountIn,chainId,orderHash,pricingTtl,registry,strategyId,taker'||body.chainId!==8453||getAddress(body.registry)!==getAddress(runtime.addresses.registry)||body.strategyId!==strategy.id||body.orderHash.toLowerCase()!==strategy.orderHash.toLowerCase()||![5,30,120].includes(body.pricingTtl)||typeof body.amountIn!=='string'||!/^\d+$/.test(body.amountIn))throw Error('Invalid controlled quote request');
 return quote(getAddress(body.taker),BigInt(body.amountIn),body.pricingTtl);
}

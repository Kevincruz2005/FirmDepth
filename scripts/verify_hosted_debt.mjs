import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {authenticateDebtRepayment,getDebtRepaymentReceipt} from '../packages/sdk/dist/debt-repayment.js';
const require=createRequire(new URL('../packages/contracts/package.json',import.meta.url));
const {createPublicClient,http,parseAbi,keccak256,decodeFunctionData}=require('viem');
const origin=new URL(process.env.FORK_DEMO_URL||'http://127.0.0.1:8086').origin;
if(process.env.RECORD_HOSTED_EVIDENCE==='1'&&(!process.env.FORK_DEMO_URL||!origin.startsWith('https://')||!new URL(origin).hostname.endsWith('.azurewebsites.net')))throw Error('Recording Azure evidence requires an explicit HTTPS Azure App Service URL');
async function get(path){const response=await fetch(origin+path);if(!response.ok)throw Error(`Hosted check failed: ${path} HTTP ${response.status}`);return response.json();}
const health=await get('/health');
const manifest=await get('/demo/deployment');
const evidence=await get('/demo/evidence');
const runtime=await get('/runtime/firmdepth.json');
if(health.phase!=='ready'||!health.proofReady||health.chainId!==8453||health.forkBlock!==51123118||manifest.hosting.generation!==health.generation||evidence.hosting.generation!==health.generation||manifest.hosting.origin!==origin||runtime.environment.hosting!=='azure'||runtime.rpcUrl!==origin+'/rpc')throw Error('Hosted fork generation or environment mismatch');
const client=createPublicClient({transport:http(origin+'/rpc',{retryCount:2,timeout:20000})});
await authenticateDebtRepayment(client,evidence.addresses.repayment,{settlement:evidence.addresses.settlement,...evidence.addresses});
await authenticateDebtRepayment(client,manifest.interactive.repayment,{settlement:runtime.settlement.address,...runtime.addresses});
if(manifest.interactive.repayment.toLowerCase()!==runtime.debtRepayment.address.toLowerCase())throw Error('Frontend targets a different interactive adapter');
async function verifyBorrow(hash,borrower){
 const [transaction,receipt]=await Promise.all([client.getTransaction({hash}),client.getTransactionReceipt({hash})]);
 const decoded=decodeFunctionData({abi:parseAbi(['function borrow(address asset,uint256 amount,uint256 interestRateMode,uint16 referralCode,address onBehalfOf)']),data:transaction.input});
 if(receipt.status!=='success'||transaction.to?.toLowerCase()!==evidence.addresses.pool.toLowerCase()||transaction.from.toLowerCase()!==borrower.toLowerCase()||decoded.functionName!=='borrow'||decoded.args[0].toLowerCase()!==evidence.addresses.usdc.toLowerCase()||decoded.args[1]!==600_000_000n||decoded.args[2]!==2n||decoded.args[4].toLowerCase()!==borrower.toLowerCase())throw Error('Position was not created by an actual supported Aave borrow');
 const debt=await client.readContract({address:evidence.addresses.variableDebtToken,abi:parseAbi(['function balanceOf(address) view returns(uint256)']),functionName:'balanceOf',args:[borrower],blockNumber:receipt.blockNumber});
 if(debt<600_000_000n)throw Error('Borrow receipt has no corresponding Aave debt balance');
}
await verifyBorrow(evidence.borrowTransaction,evidence.borrower);
await verifyBorrow(manifest.interactive.borrowTransactionHash,manifest.interactive.borrower);
for(const name of ['pool','usdc','weth','variableDebtToken','aToken','repayment','settlement']){
 const code=await client.getBytecode({address:evidence.addresses[name]});if(!code||keccak256(code)!==manifest.codeHashes[name])throw Error('Hosted code hash mismatch: '+name);
}
for(const scenario of evidence.scenarios){
 const result=await getDebtRepaymentReceipt(client,evidence.addresses.repayment,scenario.planId,scenario.transactionHash,BigInt(evidence.deployment.coreDeploymentBlock));
 for(const field of ['actualRepaid','debtBefore','debtAfter','scaledDebtBefore','scaledDebtAfter','debtIndex','usdcRefund','wethRefund'])if(result[field]!==BigInt(scenario[field]))throw Error('Hosted repayment evidence mismatch: '+field);
 if(result.path!==scenario.path)throw Error('Hosted path mismatch');
 console.log(`Verified hosted ${result.path}: ${result.actualRepaid} USDC base units; ${result.transactionHash}`);
}
if(!evidence.scenarios.some(s=>s.path==='AQUA')||!evidence.scenarios.some(s=>s.path==='BOND'))throw Error('Missing repayment path');
const failed=await client.getTransactionReceipt({hash:evidence.safeFailure.transactionHash});
if(failed.status!=='reverted'||failed.logs.length)throw Error('Failure did not revert atomically');
const read=async(address,abi,functionName,args=[])=>client.readContract({address,abi:parseAbi(abi),functionName,args,blockNumber:failed.blockNumber});
if(await read(evidence.addresses.variableDebtToken,['function scaledBalanceOf(address) view returns(uint256)'],'scaledBalanceOf',[evidence.borrower])!==BigInt(evidence.safeFailure.scaledDebt)||await read(evidence.addresses.usdc,['function balanceOf(address) view returns(uint256)'],'balanceOf',[evidence.addresses.aToken])!==BigInt(evidence.safeFailure.aTokenUsdc)||await read(evidence.addresses.bondVault,['function totalLocked() view returns(uint256)'],'totalLocked')!==BigInt(evidence.safeFailure.locked))throw Error('Failure changed historical debt, reserve cash or collateral');
const expiry=await client.getTransactionReceipt({hash:evidence.expiry.refund});if(expiry.status!=='success'||expiry.logs.some(log=>log.address.toLowerCase()===evidence.addresses.pool.toLowerCase()))throw Error('Expiry refund called Aave');
for(const method of ['eth_sendTransaction','eth_signTypedData_v4','hardhat_setBalance','evm_increaseTime','debug_traceTransaction']){
 const response=await fetch(origin+'/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]})});if(response.status!==400)throw Error('Unsafe public RPC method: '+method);
}
if((await fetch(origin+'/operator/status')).status!==401)throw Error('Operator endpoint is public');
manifest.publicVerification={verifiedAt:new Date().toISOString(),generation:health.generation,actualBorrowTransactions:true,repaymentReceipts:true,historicalRollback:true,expiryRefund:true,codeHashes:true,operatorAccessRestricted:true};
const finalHealth=await get('/health');
if(finalHealth.generation!==health.generation||finalHealth.phase!=='ready'||!finalHealth.proofReady)throw Error('Hosted fork changed during verification');
if(process.env.RECORD_HOSTED_EVIDENCE==='1'){
 await writeFile(new URL('../deployments/azure-protected-debt.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
 await writeFile(new URL('../packages/contracts/evidence/protected-debt-azure-fork.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
}
console.log('Hosted endpoint verified through public RPC: real Aave receipts, both paths, historical rollback, expiry, current frontend deployment and restricted operator access.');

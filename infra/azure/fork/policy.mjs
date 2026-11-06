import {timingSafeEqual} from 'node:crypto';

const reads=new Set(['eth_chainId','net_version','web3_clientVersion','eth_blockNumber','eth_call','eth_estimateGas','eth_getBalance','eth_getCode','eth_getStorageAt','eth_getTransactionCount','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBlockByNumber','eth_getBlockByHash','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getLogs']);
const writes=new Set(['eth_sendRawTransaction']);
export function authorized(header,token){
 if(typeof header!=='string'||typeof token!=='string'||token.length<32)return false;
 const value=Buffer.from(header);const expected=Buffer.from(`Bearer ${token}`);
 return value.length===expected.length&&timingSafeEqual(value,expected);
}
export function validateRpc(value,{operator=false,accounts=[],latestBlock=0n}={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.jsonrpc!=='2.0'||!['string','number'].includes(typeof value.id)||typeof value.method!=='string'||(value.params!==undefined&&!Array.isArray(value.params)))throw Error('Invalid JSON-RPC request');
 value={...value,params:value.params??[]};
 const {method,params}=value;
 if(!reads.has(method)&&!writes.has(method)&&!(operator&&method==='eth_sendTransaction'))throw Error('RPC method is not exposed');
 if(method==='eth_sendTransaction'){
  if(params.length!==1||!params[0]||!accounts.some(a=>a.toLowerCase()===String(params[0].from).toLowerCase()))throw Error('Operator wallet is not allowlisted');
 }
 if(method==='eth_getLogs'){
  const filter=params[0];
  if(!filter||!filter.address||(Array.isArray(filter.address)&&filter.address.length>16))throw Error('Logs require bounded addresses');
  if(!filter.blockHash){
   const block=v=>v===undefined||v==='latest'?latestBlock:typeof v==='string'&&/^0x[0-9a-f]+$/i.test(v)?BigInt(v):null;
   const from=block(filter.fromBlock);const to=block(filter.toBlock);
   if(from===null||to===null||to<from||to-from>2000n)throw Error('Log range exceeds 2000 blocks');
  }
 }
 return value;
}
export function publicError(error){
 return {code:Number.isSafeInteger(error?.code)?error.code:-32000,message:'Hosted fork request failed',...(typeof error?.data==='string'&&/^0x[0-9a-f]*$/i.test(error.data)?{data:error.data}:{})};
}
export function validateSignedTransaction(transaction,{operator=false,accounts=[],targets=[]}={}){
 const {sender,chainId,to}=transaction;
 if(chainId!==8453||!to||!targets.some(a=>a.toLowerCase()===to.toLowerCase()))throw Error('Transaction is outside the hosted deployment');
 const fixture=accounts.some(a=>a.toLowerCase()===sender.toLowerCase());
 if((!operator&&fixture)||(operator&&!fixture))throw Error('Development wallets require operator authorization');
 return transaction;
}

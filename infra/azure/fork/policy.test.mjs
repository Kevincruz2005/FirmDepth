import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authorized,validateRpc,publicError,validateSignedTransaction} from './policy.mjs';
const rpc=(method,params=[])=>({jsonrpc:'2.0',id:1,method,params});
test('operator authentication requires the exact bearer token',()=>{
 const token='a'.repeat(64);assert.equal(authorized(`Bearer ${token}`,token),true);
 for(const h of [undefined,'',`Bearer ${token}x`,'Bearer '+'b'.repeat(64)])assert.equal(authorized(h,token),false);
 assert.equal(authorized('Bearer short','short'),false);
});
test('public RPC excludes unlocked wallets, signatures, debugging and fork controls',()=>{
 for(const method of ['eth_sendTransaction','eth_sign','personal_sign','eth_signTypedData_v4','eth_accounts','hardhat_impersonateAccount','hardhat_setBalance','evm_increaseTime','evm_mine','debug_traceTransaction'])assert.throws(()=>validateRpc(rpc(method)));
 for(const method of ['eth_chainId','eth_call','eth_sendRawTransaction'])assert.equal(validateRpc(rpc(method)).method,method);
 assert.deepEqual(validateRpc({jsonrpc:'2.0',id:0,method:'eth_chainId'}).params,[]);
});
test('operator wallet is limited to configured test accounts and cannot administer the fork',()=>{
 const options={operator:true,accounts:['0xabc']};
 assert.equal(validateRpc(rpc('eth_sendTransaction',[{from:'0xAbC'}]),options).method,'eth_sendTransaction');
 assert.throws(()=>validateRpc(rpc('eth_sendTransaction',[{from:'0xdef'}]),options));
 assert.throws(()=>validateRpc(rpc('hardhat_setCode'),options));
});
test('unbounded log scans and batches are rejected',()=>{
 assert.throws(()=>validateRpc([rpc('eth_chainId')]));
 for(const filter of [{},{address:'0xabc',fromBlock:'earliest'},{address:'0xabc',fromBlock:'0x0',toBlock:'0xffff'}])assert.throws(()=>validateRpc(rpc('eth_getLogs',[filter]),{latestBlock:10000n}));
 validateRpc(rpc('eth_getLogs',[{address:'0xabc',fromBlock:'0x1',toBlock:'0x2'}]));
});
test('RPC errors retain revert data without leaking upstream URLs or credentials',()=>{
 assert.deepEqual(publicError({code:3,message:'secret https://private.invalid/key',data:'0x1234'}),{code:3,message:'Hosted fork request failed',data:'0x1234'});
 assert.equal('data' in publicError({data:{url:'secret'}}),false);
});
test('signed writes require the fork chain, known targets and protected development wallets',()=>{
 const options={accounts:['0xabc'],targets:['0xdef']};const tx={sender:'0x123',chainId:8453,to:'0xdef'};
 validateSignedTransaction(tx,options);
 assert.throws(()=>validateSignedTransaction({...tx,chainId:1},options));
 assert.throws(()=>validateSignedTransaction({...tx,to:'0x456'},options));
 assert.throws(()=>validateSignedTransaction({...tx,sender:'0xabc'},options));
 validateSignedTransaction({...tx,sender:'0xabc'},{...options,operator:true});
});

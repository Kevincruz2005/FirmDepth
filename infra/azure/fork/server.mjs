import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {authorized,validateRpc,publicError,validateSignedTransaction} from './policy.mjs';
import {hostedQuote,inspectSignedTransaction} from './quote.mjs';

const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const contracts=resolve(root,'packages/contracts');
const runtimeFile=resolve(root,'packages/frontend/.runtime/firmdepth.json');
const port=Number(process.env.PORT||8080),forkPort=Number(process.env.FORK_PORT||8545);
const origin=new URL(process.env.FORK_PUBLIC_ORIGIN||`http://127.0.0.1:${port}`).origin;
const token=process.env.FORK_OPERATOR_TOKEN;
if(!/^[a-f0-9]{64}$/.test(token||'')||![port,forkPort].every(n=>Number.isInteger(n)&&n>0&&n<65536))throw Error('Hosted fork configuration is incomplete');
const rpc=`http://127.0.0.1:${forkPort}`;
const childEnv={...process.env,FIRMDEPTH_FORK_RPC_URL:rpc,BASE_FORK_BLOCK:'51123118',FIRMDEPTH_FORK_HOLDER:'0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59',NODE_OPTIONS:'--dns-result-order=ipv4first'};
// The hosted process never inherits a production-chain signing credential.
for(const name of ['MAKER_PRIVATE_KEY','SEPOLIA_DEPLOYER_PRIVATE_KEY','SEPOLIA_RPC_URL'])delete childEnv[name];
const state={phase:'starting',generation:randomUUID(),startedAt:new Date().toISOString(),proofReady:false};
let node,child,operatorBusy=false,inFlight=0;const rates=new Map();
const logDir=resolve(process.env.FORK_LOG_DIR||resolve(root,'.fork-logs'));
await mkdir(logDir,{recursive:true});
async function run(args){
 const output=await open(resolve(logDir,'operations.log'),'a',0o600);
 try{
  child=spawn(process.execPath,[resolve(root,'node_modules/hardhat/dist/src/cli.js'),...args],{cwd:contracts,env:childEnv,stdio:['ignore',output.fd,output.fd]});
  const active=child;
  await new Promise((done,fail)=>{const timeout=setTimeout(()=>{active.kill('SIGTERM');fail(Error('Operation timed out'));},600000);active.once('error',e=>{clearTimeout(timeout);fail(e);});active.once('exit',code=>{clearTimeout(timeout);code===0?done():fail(Error('Fork operation failed'));});});
 }finally{child=undefined;await output.close();}
}
const script=name=>run(['run','--no-compile',`scripts/${name}.ts`,'--network','localBase']);
async function raw(value){const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(30000)});return response.json();}
async function internal(method,params=[]){const d=await raw({jsonrpc:'2.0',id:1,method,params});if(d.error)throw Error('Internal fork RPC failed');return d.result;}
async function readRuntime(){return JSON.parse(await readFile(runtimeFile,'utf8'));}
async function publicRuntime(){
 const runtime=await readRuntime();
 return {...runtime,rpcUrl:`${origin}/rpc`,networkName:'Azure hosted Base fork',environment:{...runtime.environment,label:'Azure Base Fork · Real Aave',hosting:'azure'},quoteProvider:{...runtime.quoteProvider,url:'/runtime/firm-quote'}};
}
async function publishProof(){
 const manifest=JSON.parse(await readFile(resolve(root,'deployments/protected-debt-base-fork.json'),'utf8'));
 const evidence=JSON.parse(await readFile(resolve(root,'packages/contracts/evidence/protected-debt-base-fork.json'),'utf8'));
 const environment='AZURE HOSTED BASE FORK — REAL AAVE CONTRACTS, NOT PUBLIC MAINNET OR SEPOLIA';
 const hosting={provider:'Azure App Service',origin,generation:state.generation,sourceCommit:process.env.FORK_SOURCE_COMMIT||'local',verifiedAt:new Date().toISOString()};
 if(manifest.interactive){manifest.interactive.frontendUrl=`${origin}/settlement`;manifest.interactive.rpcUrl=`${origin}/rpc`;}
 await writeFile(resolve(root,'deployments/azure-protected-debt.json'),JSON.stringify({...manifest,environment,hosting,evidence:'packages/contracts/evidence/protected-debt-azure-fork.json'},null,2)+'\n');
 await writeFile(resolve(root,'packages/contracts/evidence/protected-debt-azure-fork.json'),JSON.stringify({...evidence,environment,hosting},null,2)+'\n');
 state.proofReady=true;
}
async function operation(prove){
 operatorBusy=true;state.phase=prove?'proving':'preparing';
 try{
  await script('setup-debt-fork');
  if(prove){await script('demo-debt-fork');await script('verify-debt-fork');await script('setup-debt-fork');await script('verify-debt-fork');await publishProof();}
  else if(state.proofReady){await script('verify-debt-fork');await publishProof();}
  state.phase='ready';delete state.error;
 }catch{state.phase='failed';state.error='Fork preparation failed; inspect private operator logs.';}
 finally{operatorBusy=false;}
}
async function start(){
 try{
  const output=await open(resolve(logDir,'node.log'),'a',0o600);
  node=spawn(process.execPath,[resolve(root,'node_modules/hardhat/dist/src/cli.js'),'node','--network','debtFork','--hostname','127.0.0.1','--port',String(forkPort)],{cwd:contracts,env:childEnv,stdio:['ignore',output.fd,output.fd]});
  node.once('exit',()=>{state.phase='failed';state.error='Fork node stopped; this generation is unavailable.';state.proofReady=false;});
  node.once('error',()=>{state.phase='failed';state.error='Fork node could not start.';});
  let ready=false;
  for(let i=0;i<90;i++){
   try{const metadata=await internal('hardhat_metadata');if(metadata.forkedNetwork?.forkBlockNumber!==51123118||await internal('eth_chainId')!=='0x2105')throw Error('Wrong fork');ready=true;break;}catch{}
   await new Promise(r=>setTimeout(r,1000));
  }
  await output.close();if(!ready)throw Error('Fork startup timed out');
  await operation(false);
 }catch{state.phase='failed';state.error='Fork startup failed; inspect private operator logs.';}
}
function json(res,status,value){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value,(_k,v)=>typeof v==='bigint'?v.toString():v));}
async function body(req){let result='';for await(const chunk of req){result+=chunk;if(Buffer.byteLength(result)>65536)throw Error('Request too large');}return JSON.parse(result||'{}');}
function rate(req,kind,limit){
 const key=`${kind}:${String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',').at(-1).trim()}`;
 const minute=Math.floor(Date.now()/60000);let bucket=rates.get(key);if(!bucket||bucket.minute!==minute){bucket={minute,count:0};rates.set(key,bucket);}return ++bucket.count<=limit;
}
setInterval(()=>{const minute=Math.floor(Date.now()/60000);for(const[k,v]of rates)if(v.minute<minute)rates.delete(k);},60000).unref();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.json':'application/json'};
createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,origin).pathname;
  if(path==='/rpc'){
   res.setHeader('access-control-allow-origin','*');res.setHeader('access-control-allow-headers','content-type');res.setHeader('access-control-allow-methods','POST, OPTIONS');
   if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  }
  if(path.startsWith('/operator/')){
   if(!authorized(req.headers.authorization,token))return json(res,401,{error:'Operator authorization required'});
   if(req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:'Origin is not allowed'});
   if(path==='/operator/status'&&req.method==='GET')return json(res,200,state);
   if(['/operator/prove','/operator/reset'].includes(path)&&req.method==='POST'){
    if(operatorBusy||state.phase==='starting')return json(res,409,{error:'A fork operation is already running'});
    if(Object.keys(await body(req)).length)return json(res,400,{error:'Operation does not accept parameters'});
    void operation(path.endsWith('prove'));return json(res,202,{accepted:true,generation:state.generation});
   }
  }
  if(path==='/health'&&req.method==='GET')return json(res,state.phase==='ready'?200:503,{status:state.phase==='ready'?'ok':'initializing',environment:'azure-base-fork',chainId:8453,forkBlock:51123118,...state});
  if(state.phase!=='ready'&&!path.startsWith('/assets/'))return json(res,503,{error:'The controlled fork is preparing. Retry shortly.',phase:state.phase});
  if(path==='/runtime/firmdepth.json'&&req.method==='GET')return json(res,200,await publicRuntime());
  if(['/demo/evidence','/demo/deployment'].includes(path)&&req.method==='GET'){
   if(!state.proofReady)return json(res,404,{error:'No verified proof for this fork generation'});
   const file=path.endsWith('evidence')?'packages/contracts/evidence/protected-debt-azure-fork.json':'deployments/azure-protected-debt.json';
   return json(res,200,JSON.parse(await readFile(resolve(root,file),'utf8')));
  }
  if(['/rpc','/operator/rpc'].includes(path)&&req.method==='POST'){
   if(inFlight>=24||!rate(req,'rpc',3000))return json(res,429,{error:'RPC limit reached; retry shortly'});
   inFlight++;
   try{
    const runtime=await readRuntime();const value=validateRpc(await body(req),{operator:path.startsWith('/operator/'),accounts:[runtime.accounts.trader,runtime.accounts.drainer],latestBlock:BigInt(await internal('eth_blockNumber'))});
    if(value.method==='eth_sendRawTransaction'){
     if(!rate(req,'send',60))return json(res,429,{error:'Transaction limit reached'});
     validateSignedTransaction(await inspectSignedTransaction(value.params[0]),{operator:path.startsWith('/operator/'),accounts:path.startsWith('/operator/')?[runtime.accounts.trader,runtime.accounts.drainer]:Object.values(runtime.accounts),targets:[...Object.values(runtime.addresses),runtime.settlement.address,runtime.debtRepayment.address,runtime.debtRepayment.pool]});
    }
    const result=await raw(value);return json(res,200,result.error?{jsonrpc:'2.0',id:value.id,error:publicError(result.error)}:result);
   }finally{inFlight--;}
  }
  if(['/runtime/firm-quote','/runtime/settlement-quote'].includes(path)&&req.method==='POST'){
   if(!rate(req,'quote',30))return json(res,429,{error:'Quote limit reached'});
   try{return json(res,200,await hostedQuote(await readRuntime(),await body(req),path.endsWith('settlement-quote'),rpc));}
   catch{return json(res,400,{error:'The requested quote does not satisfy the funded plan or current controlled inventory.'});}
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});
  const dist=resolve(root,'packages/frontend/dist');
  const file=path.startsWith('/assets/')||path==='/favicon.svg'?resolve(dist,'.'+decodeURIComponent(path)):resolve(dist,'index.html');
  if(!file.startsWith(dist+sep))return json(res,404,{error:'Not found'});
  const content=await readFile(file);res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':path.startsWith('/assets/')?'public,max-age=31536000,immutable':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin','x-frame-options':'DENY'});res.end(req.method==='HEAD'?undefined:content);
 }catch(error){json(res,400,{error:error?.code==='ENOENT'?'Not found':'Request rejected'});}
}).listen(port,'0.0.0.0',()=>{console.log(JSON.stringify({event:'hosted_fork_starting',port,origin,generation:state.generation}));void start();});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{child?.kill(signal);node?.kill(signal);process.exit(0);});

import {cp,mkdir,readFile,writeFile,rm,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const target=resolve(root,'.azure-package/hosted-debt');
await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
const copy=async(from,to=from)=>{await mkdir(resolve(target,to,'..'),{recursive:true});await cp(resolve(root,from),resolve(target,to),{recursive:true});};
await copy('infra/azure/fork');
for(const file of ['package.json','package-lock.json'])await copy(`infra/azure/fork/${file}`,file);
await copy('infra/azure/fork/hardhat.config.ts','packages/contracts/hardhat.config.ts');
await writeFile(resolve(target,'packages/contracts/package.json'),JSON.stringify({name:'firmdepth-fork-contracts',private:true,type:'module'}));
await copy('packages/contracts/artifacts/contracts');
await copy('packages/sdk/dist');
await writeFile(resolve(target,'packages/sdk/package.json'),JSON.stringify({name:'firmdepth-fork-sdk',private:true,type:'module'}));
await copy('packages/frontend/dist');
await mkdir(resolve(target,'deployments'),{recursive:true});
await mkdir(resolve(target,'packages/contracts/evidence'),{recursive:true});
for(const file of ['setup-frontend-fork.ts','setup-protected-fork.ts','setup-debt-fork.ts','demo-debt-fork.ts','verify-debt-fork.ts','adjust-debt-fork.ts','lib/base-fork.ts','lib/aave-base.ts'])await copy(`packages/contracts/scripts/${file}`);
const require=createRequire(resolve(root,'packages/quote-service/package.json'));const {build}=require('esbuild');
await build({entryPoints:[resolve(root,'infra/azure/fork/quote-entry.mjs')],outfile:resolve(target,'infra/azure/fork/quote.mjs'),nodePaths:[resolve(root,'packages/quote-service/node_modules')],bundle:true,platform:'node',format:'esm',target:'node22',sourcemap:false,banner:{js:"import {createRequire as __bundleRequire} from 'node:module';const require=__bundleRequire(import.meta.url);"}});
const result=spawnSync('npm',['ci','--omit=dev','--no-audit','--no-fund'],{cwd:target,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
const secretNames=['MAKER_PRIVATE_KEY','SEPOLIA_DEPLOYER_PRIVATE_KEY','SEPOLIA_RPC_URL','FORK_OPERATOR_TOKEN'];
const values=secretNames.map(k=>process.env[k]).filter(v=>v?.length>16);
// Only explicit files are copied; environment files, production manifests,
// browser-test output and private logs never enter the deployment archive.
for(const file of ['infra/azure/fork/server.mjs','infra/azure/fork/quote.mjs','packages/frontend/dist/index.html']){
 const text=await readFile(resolve(target,file),'utf8');if(values.some(v=>text.includes(v)))throw Error('Credential detected in deployment package');
}
await writeFile(resolve(target,'deployment-source.json'),JSON.stringify({sourceCommit:process.env.FORK_SOURCE_COMMIT||'working-tree',forkBlock:51123118,environment:'azure-hosted-base-fork'},null,2)+'\n');
console.log(`Hosted fork package prepared at ${target}`);

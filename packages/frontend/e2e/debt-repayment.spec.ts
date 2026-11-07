import {expect,test,type Page} from "@playwright/test";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";

test.describe("real Aave protected repayment",()=>{
 test.skip(process.env.FIRMDEPTH_DEBT_E2E!=="1","Requires a canonical Base fork with real Aave contracts");
 test.setTimeout(240000);
 test.beforeEach(()=>{execFileSync("npx",["hardhat","run","scripts/setup-debt-fork.ts","--network","localBase"],{cwd:resolve(process.cwd(),"../contracts"),env:process.env,stdio:"pipe"});});
 test("rejects a different wallet RPC before creating a repayment",async({page})=>{
  const runtime=JSON.parse(readFileSync(".runtime/firmdepth.json","utf8"));
  await installReadWriteForkWallet(page,runtime.rpcUrl,runtime.accounts.trader,true);
  await page.goto("/settlement");await page.getByRole("button",{name:"Debt Repayment",exact:true}).click();
  await expect(page.locator(".verified-debt")).toContainText("Verified borrower debt:",{timeout:45000});
  await page.getByRole("button",{name:"Connect wallet",exact:true}).click();
  await page.getByRole("button",{name:/Local Aave Fork Wallet/}).click();
  await expect(page.locator(".wallet-dialog-error")).toContainText("cannot see this fork",{timeout:30000});
  await expect(page.getByRole("button",{name:"Create repayment plan",exact:true})).toBeDisabled();
  await expect(page.getByRole("heading",{name:"CREATED",exact:true})).not.toBeVisible();
  const methods=await page.evaluate(()=>(window as unknown as {forkWalletMethods:string[]}).forkWalletMethods);
  expect(methods).not.toContain("eth_sendTransaction");
 });
 for(const path of ["Aqua","Bond","Partial","Expiry"]as const)test(`repays real Aave debt through ${path}`,async({page,context})=>{
  const runtime=JSON.parse(readFileSync(".runtime/firmdepth.json","utf8"));
  await installReadWriteForkWallet(page,runtime.rpcUrl,runtime.accounts.trader);
  await page.goto("/settlement");await page.getByRole("button",{name:"Debt Repayment",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Create immutable debt repayment",exact:true})).toBeVisible({timeout:45000});
  await expect(page.locator(".verified-debt")).toContainText("Verified borrower debt:",{timeout:30000});
  await expect(page.getByText(runtime.settlement.address,{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Create repayment plan",exact:true}).click();
  await expect(page.getByRole("heading",{name:"CREATED",exact:true})).toBeVisible({timeout:30000});
  await page.getByRole("button",{name:"Approve and fund repayment",exact:true}).click();
  await expect(page.getByRole("heading",{name:"FUNDED",exact:true})).toBeVisible({timeout:30000});
  await page.getByRole("button",{name:"Inspect repayment quote",exact:true}).click();
  await expect(page.getByRole("button",{name:"Accept repayment commitment",exact:true})).toBeVisible({timeout:30000});
  await expect(page.getByText(/USDC minimum: 200/)).toBeVisible();
  await page.getByRole("button",{name:"Accept repayment commitment",exact:true}).click();
  await expect(page.getByRole("heading",{name:"ACCEPTED",exact:true})).toBeVisible({timeout:30000});
  await page.reload();await page.getByRole("button",{name:"Debt Repayment",exact:true}).click();
  await expect(page.getByRole("heading",{name:"ACCEPTED",exact:true})).toBeVisible({timeout:45000});
  if(path==="Expiry"){
   for(const[method,params]of [["evm_increaseTime",[121]],["evm_mine",[]]]as const)await page.request.post(runtime.rpcUrl,{data:{jsonrpc:"2.0",id:1,method,params}});
   await page.getByRole("button",{name:"Refund repayment after expiry",exact:true}).click();
   await expect(page.getByRole("heading",{name:"REFUNDED",exact:true})).toBeVisible({timeout:30000});return;
  }
  if(path==="Bond"){
   const drain=await context.newPage();await installReadWriteForkWallet(drain,runtime.rpcUrl,runtime.accounts.drainer);await drain.goto("/trade");
   await drain.getByRole("tab",{name:"Soft",exact:true}).click();await drain.getByLabel("WETH amount").fill("1");
   await expect(drain.getByText(/SwapVM quote · block/)).toBeVisible({timeout:30000});
   await drain.getByRole("button",{name:"Execute Soft swap",exact:true}).click();
   await expect(drain.getByText(/Soft execution confirmed/)).toBeVisible({timeout:30000});await drain.close();
  }
  if(path==="Partial")execFileSync("npx",["hardhat","run","scripts/adjust-debt-fork.ts","--network","localBase"],{cwd:resolve(process.cwd(),"../contracts"),env:process.env,stdio:"pipe"});
  await page.getByRole("button",{name:"Execute atomic repayment",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Verified Aave repayment",exact:true})).toBeVisible({timeout:45000});
  await expect(page.locator(".verified-repayment")).toContainText(path==="Bond"?"Covered bond settlement":"Aqua settlement");
  if(path==="Partial"){
   const text=await page.locator(".verified-repayment").innerText();const actual=Number(text.match(/Actual USDC repaid: ([0-9.]+)/)?.[1]);expect(actual).toBeGreaterThan(0);expect(actual).toBeLessThan(200);
   await expect(page.locator(".verified-repayment")).toContainText("Debt after: 0 USDC");
  }else await expect(page.locator(".verified-repayment")).toContainText("Actual USDC repaid: 200");
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.reload();await page.getByRole("button",{name:"Debt Repayment",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Verified Aave repayment",exact:true})).toBeVisible({timeout:45000});
  if(path==="Aqua"){
   await page.getByRole("button",{name:"Create repayment plan",exact:true}).click();
   await expect(page.getByRole("heading",{name:"CREATED",exact:true})).toBeVisible({timeout:30000});
   await expect(page.getByRole("heading",{name:"Verified Aave repayment",exact:true})).not.toBeVisible();
   await page.getByRole("button",{name:"Cancel repayment and refund",exact:true}).click();
   await expect(page.getByRole("heading",{name:"REFUNDED",exact:true})).toBeVisible({timeout:30000});
  }
  await page.getByRole("button",{name:"Payout",exact:true}).click();await expect(page.getByRole("heading",{name:"Create immutable payouts",exact:true})).toBeVisible();
 });
});
async function installReadWriteForkWallet(page:Page,rpcUrl:string,account:string,wrongBlock=false){
 await page.addInitScript(({url,selectedAccount,mismatchedBlock})=>{
  let id=0;const methods:string[]=[];Object.assign(window,{forkWalletMethods:methods});const listeners=new Map<string,Set<(...args:unknown[])=>void>>();
  const provider={async request({method,params}:{method:string;params?:unknown[]|object}){
   methods.push(method);
   if(method==="wallet_addEthereumChain"||method==="wallet_switchEthereumChain")return null;
   if(method==="eth_accounts"||method==="eth_requestAccounts")return[selectedAccount];
   if(method==="eth_getBlockByHash"&&mismatchedBlock)return null;
   const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:++id,method,params:params??[]})});
   const payload=await response.json();if(payload.error)throw Error(payload.error.message);return payload.result;
  },on(event:string,listener:(...args:unknown[])=>void){const set=listeners.get(event)??new Set();set.add(listener);listeners.set(event,set);},removeListener(event:string,listener:(...args:unknown[])=>void){listeners.get(event)?.delete(listener);}};
  const announce=()=>window.dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:Object.freeze({info:{uuid:"00000000-0000-4000-8000-000000000002",name:"Local Aave Fork Wallet",icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",rdns:"test.firmdepth.aave"},provider})}));
  window.addEventListener("eip6963:requestProvider",announce);Object.defineProperty(window,"ethereum",{value:provider,configurable:true});
 },{url:rpcUrl,selectedAccount:account,mismatchedBlock:wrongBlock});
}

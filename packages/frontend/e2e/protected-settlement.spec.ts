import {expect,test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
test.describe("protected settlement local transactions",()=>{
 test.skip(process.env.FIRMDEPTH_PROTECTED_E2E!=="1","Requires protected fork runner");
 test.setTimeout(180_000);
 test.beforeEach(()=>{execFileSync("npx",["hardhat","run","scripts/setup-protected-fork.ts","--network","localBase"],{cwd:resolve(process.cwd(),"../contracts"),env:{...process.env,FIRMDEPTH_FORK_HOLDER:"0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59"},stdio:"pipe"});});
 for (const path of ["Aqua","Bond","Expiry"]) test(`creates funds accepts and settles through ${path}`,async({page,context})=>{
 const runtime=JSON.parse(readFileSync(".runtime/firmdepth.json","utf8"));
 await installRpcWallet(page,runtime.rpcUrl,runtime.accounts.trader);
 await page.goto("/settlement");
 await expect(page.getByText("LIVE LOCAL FORK · not public testnet")).toBeVisible({timeout:30_000});
 await page.getByLabel("Recipient 1",{exact:true}).fill("0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65");
 await page.getByLabel("Recipient 2",{exact:true}).fill("0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc");
 await page.getByRole("button",{name:"Create payout plan",exact:true}).click();
 await expect(page.getByRole("heading",{name:"CREATED",exact:true})).toBeVisible({timeout:30_000});
 await page.getByRole("button",{name:"Approve and fund",exact:true}).click();
 await expect(page.getByRole("heading",{name:"FUNDED",exact:true})).toBeVisible({timeout:30_000});
 await page.getByRole("button",{name:"Inspect signed quote",exact:true}).click();
 await expect(page.getByRole("button",{name:"Accept commitment",exact:true})).toBeVisible({timeout:30_000});
 await page.getByRole("button",{name:"Accept commitment",exact:true}).click();
 await expect(page.getByRole("heading",{name:"ACCEPTED",exact:true})).toBeVisible({timeout:30_000});
 await page.reload();
 await expect(page.getByRole("heading",{name:"ACCEPTED",exact:true})).toBeVisible({timeout:30_000});
 if(path==="Expiry") {
   for(const [method,params] of [["evm_increaseTime",[121]],["evm_mine",[]]] as const) await fetch(runtime.rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
   await page.getByRole("button",{name:"Refund after expiry",exact:true}).click();
   await expect(page.getByRole("heading",{name:"REFUNDED",exact:true})).toBeVisible({timeout:30_000});return;
 }
 if(path==="Bond") {
   const drain=await context.newPage();await installRpcWallet(drain,runtime.rpcUrl,runtime.accounts.drainer);await drain.goto("/trade");
   await drain.getByRole("tab",{name:"Soft",exact:true}).click();
   await drain.getByLabel("WETH amount").fill("1");
   await expect(drain.getByText(/SwapVM quote · block/)).toBeVisible({timeout:30_000});
   await drain.getByRole("button",{name:"Execute Soft swap",exact:true}).click();
   await expect(drain.getByText(/Soft execution confirmed/)).toBeVisible({timeout:30_000});await drain.close();
 }
 await page.getByRole("button",{name:"Execute atomic payouts",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Verified recipient payments",exact:true})).toBeVisible({timeout:30_000});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 });
});
async function installRpcWallet(page: import("@playwright/test").Page, rpcUrl: string, account: string) {
  await page.addInitScript(({ url, selectedAccount }) => {
    let requestId = 0;
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const provider = {
      async request({ method, params }: { method: string; params?: unknown[] | object }) {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [selectedAccount];
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params: params ?? [] }),
        });
        const payload = await response.json();
        if (payload.error) throw new Error(payload.error.message);
        return payload.result;
      },
      on(event: string, listener: (...args: unknown[]) => void) { const values = listeners.get(event) ?? new Set(); values.add(listener); listeners.set(event, values); },
      removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
    };
    (window as any).__emitEthereum = (event: string, value: unknown) => { for (const listener of listeners.get(event) ?? []) listener(value); };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "00000000-0000-4000-8000-000000000001", name: "Base Fork Test Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "test.firmdepth.wallet" }, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  }, { url: rpcUrl, selectedAccount: account });
}

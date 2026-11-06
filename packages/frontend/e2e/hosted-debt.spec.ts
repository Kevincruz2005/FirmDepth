import {test,expect,type Page} from '@playwright/test';
const enabled=process.env.FIRMDEPTH_HOSTED_E2E==='1';
const origin=process.env.FIRMDEPTH_E2E_BASE_URL;
const token=process.env.FORK_OPERATOR_TOKEN;
test.describe('Azure hosted fork repayment',()=>{
 test.skip(!enabled,'Requires an isolated hosted fork and operator token');
 test.setTimeout(300000);
 test('blocks public signing, unlocked transactions and fork administration',async({request})=>{
  for(const method of ['eth_sendTransaction','eth_signTypedData_v4','hardhat_setBalance','evm_increaseTime','debug_traceTransaction']){
   const response=await request.post(`${origin}/rpc`,{data:{jsonrpc:'2.0',id:1,method,params:[]}});expect(response.status()).toBe(400);
  }
  expect((await request.post(`${origin}/operator/reset`,{data:{}})).status()).toBe(401);
  expect((await request.get(`${origin}/operator/status`)).status()).toBe(401);
 });
 for(const path of ['Aqua','Bond'])test(`executes actual ${path} repayment through the hosted frontend`,async({page,context,request})=>{
  if(!token)throw Error('FORK_OPERATOR_TOKEN is required; never put it in source or build assets');
  const reset=await request.post(`${origin}/operator/reset`,{headers:{authorization:`Bearer ${token}`},data:{}});expect(reset.status()).toBe(202);
  await expect.poll(async()=>{const response=await request.get(`${origin}/health`);return (await response.json()).phase;},{timeout:120000,intervals:[1000,2000]}).toBe('ready');
  const runtime=await(await request.get(`${origin}/runtime/firmdepth.json`)).json();
  await wallet(page,runtime.accounts.trader,token);
  await page.goto(`${origin}/settlement`);await page.getByRole('button',{name:'Debt Repayment',exact:true}).click();
  await expect(page.getByText('LIVE AZURE FORK · real Aave contracts · not public mainnet',{exact:true})).toBeVisible({timeout:45000});
  await expect(page.locator('.verified-debt')).toContainText('Verified borrower debt: 600',{timeout:45000});
  await page.getByRole('button',{name:'Create repayment plan',exact:true}).click();await expect(page.getByRole('heading',{name:'CREATED',exact:true})).toBeVisible({timeout:45000});
  await page.getByRole('button',{name:'Approve and fund repayment',exact:true}).click();await expect(page.getByRole('heading',{name:'FUNDED',exact:true})).toBeVisible({timeout:45000});
  await page.getByRole('button',{name:'Inspect repayment quote',exact:true}).click();await expect(page.getByRole('button',{name:'Accept repayment commitment',exact:true})).toBeVisible({timeout:45000});
  await page.getByRole('button',{name:'Accept repayment commitment',exact:true}).click();await expect(page.getByRole('heading',{name:'ACCEPTED',exact:true})).toBeVisible({timeout:45000});
  if(path==='Bond'){
   const drain=await context.newPage();await wallet(drain,runtime.accounts.drainer,token);await drain.goto(`${origin}/trade`);
   await drain.getByRole('tab',{name:'Soft',exact:true}).click();await drain.getByLabel('WETH amount').fill('1');
   await expect(drain.getByText(/SwapVM quote · block/)).toBeVisible({timeout:45000});await drain.getByRole('button',{name:'Execute Soft swap',exact:true}).click();
   await expect(drain.getByText(/Soft execution confirmed/)).toBeVisible({timeout:45000});await drain.close();
  }
  await page.getByRole('button',{name:'Execute atomic repayment',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Verified Aave repayment',exact:true})).toBeVisible({timeout:60000});
  await expect(page.locator('.verified-repayment')).toContainText(path==='Aqua'?'Aqua settlement':'Covered bond settlement');
  await expect(page.locator('.verified-repayment')).toContainText('Actual USDC repaid: 200');
  await page.reload();await page.getByRole('button',{name:'Debt Repayment',exact:true}).click();await expect(page.getByRole('heading',{name:'Verified Aave repayment',exact:true})).toBeVisible({timeout:60000});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 });
});
async function wallet(page:Page,account:string,operatorToken:string){
 await page.addInitScript(({selected,secret})=>{
  let id=0;const provider={async request({method,params}:{method:string;params?:unknown[]}){
   if(['eth_accounts','eth_requestAccounts'].includes(method))return[selected];
   const response=await fetch('/operator/rpc',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${secret}`},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params:params??[]})});
   const d=await response.json();if(d.error)throw Error(typeof d.error==='string'?d.error:d.error.message);return d.result;
  },on(){},removeListener(){}};
  const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:Object.freeze({info:{uuid:'00000000-0000-4000-8000-000000000003',name:'Hosted Fork Operator Wallet',icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",rdns:'test.firmdepth.hosted'},provider})}));
  window.addEventListener('eip6963:requestProvider',announce);Object.defineProperty(window,'ethereum',{value:provider,configurable:true});
 },{selected:account,secret:operatorToken});
}

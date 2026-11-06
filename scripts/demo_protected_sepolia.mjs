// Real public Sepolia transactions. No impersonation, time travel, or liquidity drain.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { authenticateSettlement, settlementAbi, readPlan, getPayoutReceipt } from '../packages/sdk/dist/settlement.js';
import { validateFirmQuoteEnvelope } from '../packages/sdk/dist/quote-provider.js';
const require = createRequire(new URL('../packages/contracts/package.json', import.meta.url));
const { createPublicClient, createWalletClient, http, parseEther, parseAbi, toHex } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { sepolia } = require('viem/chains');
const manifest = JSON.parse(await readFile(new URL('../deployments/sepolia.json', import.meta.url), 'utf8'));
const deployment = JSON.parse(await readFile(new URL('../deployments/protected-sepolia.json', import.meta.url), 'utf8'));
const api = process.env.PUBLIC_API_URL?.replace(/\/$/, '');
if (!api || !process.env.SEPOLIA_RPC_URL || !process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY) throw Error('Export PUBLIC_API_URL, SEPOLIA_RPC_URL and SEPOLIA_DEPLOYER_PRIVATE_KEY');
const account = privateKeyToAccount(process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY);
const transport = http(process.env.SEPOLIA_RPC_URL, { timeout: 15000, retryCount: 2 });
const client = createPublicClient({ chain: sepolia, transport });
const wallet = createWalletClient({ account, chain: sepolia, transport });
const tokenAbi = parseAbi(['function deposit() payable', 'function approve(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)']);
const directory = new URL('../.azure-package/', import.meta.url);
const journalFile = new URL('public-payout-session.json', directory);
const evidenceFile = new URL('../packages/contracts/evidence/protected-settlement-sepolia.json', import.meta.url);
let phase = 'preflight';
let journal = { api, payer: account.address, settlement: deployment.address, transactions: {} };
const save = async () => { await mkdir(directory, { recursive: true }); await writeFile(journalFile, JSON.stringify(journal, null, 2) + '\n'); };
const delay = () => new Promise(resolve => setTimeout(resolve, 3000));
async function converge(read) {
  for (let attempt = 0; ; attempt++) {
    try { return await read(); } catch (error) { if (attempt === 5) throw error; await delay(); }
  }
}
async function send(name, request, sender = wallet) {
  phase = name;
  // Retry simulations only. Never resubmit a transaction after a receipt timeout.
  const simulation = await converge(() => client.simulateContract({ account: sender.account, ...request }));
  const hash = await sender.writeContract(simulation.request);
  journal.transactions[name] = hash;
  await save();
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180000 });
  if (receipt.status !== 'success') throw Error('Transaction reverted');
  console.log(`${name}: ${hash}`);
  return receipt;
}
try {
  if (await client.getChainId() !== 11155111) throw Error('Sepolia is required');
  await authenticateSettlement(client, deployment.address, manifest.addresses);
  const runtime = await (await fetch(`${api}/runtime`, { signal: AbortSignal.timeout(20000) })).json();
  if (runtime.chainId !== 11155111 || runtime.settlement?.address.toLowerCase() !== deployment.address.toLowerCase()) throw Error('API deployment mismatch');
  const amountIn = parseEther('0.0001'), maxPremium = parseEther('0.00002');
  const payouts = [{ recipient: account.address, amount: 120000n }, { recipient: manifest.maker, amount: 80000n }];
  const resumed = process.env.SETTLEMENT_DEMO_PLAN_ID;
  if (resumed) {
    journal = JSON.parse(await readFile(journalFile, 'utf8'));
    if (journal.planId !== resumed || journal.payer.toLowerCase() !== account.address.toLowerCase() || journal.settlement.toLowerCase() !== deployment.address.toLowerCase()) throw Error('Resume journal mismatch');
  } else {
    const balance = await client.readContract({ address: manifest.addresses.weth, abi: tokenAbi, functionName: 'balanceOf', args: [account.address] });
    if (balance < amountIn + maxPremium) await send('wrap', { address: manifest.addresses.weth, abi: tokenAbi, functionName: 'deposit', value: amountIn + maxPremium - balance });
    await send('approve', { address: manifest.addresses.weth, abi: tokenAbi, functionName: 'approve', args: [deployment.address, amountIn + maxPremium] });
    const nonce = BigInt(toHex(crypto.getRandomValues(new Uint8Array(16))));
    const block = await client.getBlock();
    journal.planId = await client.readContract({ address: deployment.address, abi: settlementAbi, functionName: 'planIdFor', args: [account.address, nonce] });
    await save();
    await send('create', { address: deployment.address, abi: settlementAbi, functionName: 'createPlan', args: [nonce, amountIn, maxPremium, block.timestamp + 3600n, payouts] });
  }
  const id = journal.planId;
  let plan = await converge(async () => { const p = await readPlan(client, deployment.address, id); if (!p.state) throw Error('Plan not visible'); return p; });
  if (plan.payer.toLowerCase() !== account.address.toLowerCase()) throw Error('Payer mismatch');
  if (plan.state === 1) {
    await send('fund', { address: deployment.address, abi: settlementAbi, functionName: 'fundPlan', args: [id] });
    plan = await converge(async () => { const p = await readPlan(client, deployment.address, id); if (p.state !== 2) throw Error('Funding not visible'); return p; });
  }
  const firm = manifest.strategies.find(strategy => strategy.kind === 'FIRM');
  const order = { ...firm.order, traits: BigInt(firm.order.traits) };
  if (plan.state === 2) {
    phase = 'quote';
    const body = await converge(async () => {
      const response = await fetch(`${api}/quote/settlement`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chainId: 11155111, settlement: deployment.address, planId: id, pricingTtl: 120 }), signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error('Quote unavailable');
      return response.json();
    });
    const quote = body.quote;
    for (const key of ['amountIn','referenceAmountOut','minAmountOut','requiredBond','premiumAmount','sigmaWad','annualCapitalRateWad','utilizationAfterWad','minPremiumOut','expiry','nonce']) quote[key] = BigInt(quote[key]);
    await validateFirmQuoteEnvelope(client, { quote, makerSignature: body.makerSignature, quotedAtBlock: BigInt(body.quotedAtBlock) }, { chainId: 11155111, registry: manifest.addresses.registry, executor: manifest.addresses.executor, router: manifest.addresses.firmRouter, tokenIn: manifest.addresses.weth, tokenOut: manifest.addresses.usdc, orderHash: firm.orderHash, order, maker: manifest.maker, taker: deployment.address, amountIn: plan.amountIn, pricingTtl: 120 });
    await send('accept', { address: deployment.address, abi: settlementAbi, functionName: 'acceptPlan', args: [id, quote, order, body.makerSignature] });
    plan = await converge(async () => { const p = await readPlan(client, deployment.address, id); if (p.state !== 3) throw Error('Acceptance not visible'); return p; });
  }
  if (plan.state === 3) await send('execute', { address: deployment.address, abi: settlementAbi, functionName: 'executePlan', args: [id, order] });
  phase = 'receipt verification';
  const receipt = await converge(() => getPayoutReceipt(client, deployment.address, id, journal.transactions.execute, BigInt(deployment.blockNumber)));
  if (process.env.RESEED_AFTER_DEMO === '1') {
    phase = 'reseed';
    if (!process.env.MAKER_PRIVATE_KEY) throw Error('MAKER_PRIVATE_KEY is required for reseeding');
    const maker = privateKeyToAccount(process.env.MAKER_PRIVATE_KEY);
    if (maker.address.toLowerCase() !== manifest.maker.toLowerCase()) throw Error('Maker mismatch');
    const aquaAbi = parseAbi(['function rawBalances(address,address,bytes32,address) view returns(uint248,uint8)', 'function push(address,address,bytes32,address,uint256)']);
    const args = [manifest.maker, manifest.addresses.firmRouter, firm.orderHash, manifest.addresses.usdc];
    const target = BigInt(firm.virtualBalances.usdc);
    const [current, count] = await client.readContract({ address: manifest.addresses.aqua, abi: aquaAbi, functionName: 'rawBalances', args });
    if (count !== 2) throw Error('Firm strategy is inactive');
    const backing = await client.readContract({ address: manifest.addresses.usdc, abi: tokenAbi, functionName: 'balanceOf', args: [manifest.maker] });
    if (backing < target) throw Error('Insufficient maker inventory to reseed');
    if (current < target) await send('reseed', { address: manifest.addresses.aqua, abi: aquaAbi, functionName: 'push', args: [...args, target - current] }, createWalletClient({ account: maker, chain: sepolia, transport }));
  }
  const balances = await Promise.all(receipt.payouts.map(async payout => ({ ...payout, balanceAfter: await client.readContract({ address: manifest.addresses.usdc, abi: tokenAbi, functionName: 'balanceOf', args: [payout.recipient] }) })));
  const evidence = { environment: 'public-sepolia', chainId: 11155111, api, settlement: deployment.address, ...journal, ...receipt, path: receipt.status === 2 ? 'AQUA' : 'BOND', payouts: balances, note: 'Recipients are payer and maker. Maker net balance also includes the swap output debit; SDK verifies exact wrapper-to-recipient transfers.', verifiedAt: new Date().toISOString() };
  await writeFile(evidenceFile, JSON.stringify(evidence, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
  console.log(`Verified ${evidence.path} recipient transfers; evidence: packages/contracts/evidence/protected-settlement-sepolia.json`);
} catch (error) {
  const reason = String(error.shortMessage ?? error.message ?? 'Unknown error').split('\n')[0].replace(/https?:\/\/\S+/g, '[URL]');
  console.error(`Demo stopped during ${phase}: ${reason}. Public plan: ${journal.planId ?? 'not created'}. Transaction journal: .azure-package/public-payout-session.json. Resume using SETTLEMENT_DEMO_PLAN_ID; an expired accepted plan must be refunded by its payer.`);
  process.exitCode = 1;
}

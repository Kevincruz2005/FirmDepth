import type {} from "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";
import { ethers as ethersLibrary } from "ethers";
import { createPublicClient, custom } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { authenticateFirmDepthDeployment } from "../../sdk/dist/deployment.js";
import { signFirmQuote } from "../../sdk/dist/eip712.js";
import { buildFirmQuote } from "../../sdk/dist/quote.js";
import { getFirmExecutionReceipt } from "../../sdk/dist/receipt.js";
import { readPublicManifest, requiredKey, SEPOLIA_CHAIN_ID } from "./lib/public-demo.ts";

const { ethers, provider: networkProvider } = await network.create();
const provider = ethers.provider;
if ((await provider.getNetwork()).chainId !== SEPOLIA_CHAIN_ID) throw new Error("Sepolia fork must preserve chain ID 11155111");
const manifest = await readPublicManifest();
if (manifest.status !== "ready") throw new Error("A ready public Sepolia manifest is required for fork rehearsal");
const makerKey = requiredKey("MAKER_PRIVATE_KEY");
const maker = new ethersLibrary.Wallet(makerKey);
const makerViem = privateKeyToAccount(makerKey as `0x${string}`);
if (maker.address !== ethersLibrary.getAddress(manifest.maker)) throw new Error("MAKER_PRIVATE_KEY does not match the public manifest");
const [, trader, drainer] = await ethers.getSigners();
if (!trader || !drainer) throw new Error("Sepolia rehearsal requires two funded fork accounts");
const [traderAddress, drainerAddress] = await Promise.all([trader.getAddress(), drainer.getAddress()]);

const viemClient = createPublicClient({ transport: custom({ request: ({ method, params }) => networkProvider.request({ method, params: params as any }) }) });
await authenticateFirmDepthDeployment(viemClient as never, manifest.addresses);
const firmStrategy = manifest.strategies.find((value: any) => value.kind === "FIRM");
const softStrategy = manifest.strategies.find((value: any) => value.kind === "SOFT");
if (!firmStrategy || !softStrategy) throw new Error("Manifest strategies are incomplete");
const firmOrder = order(firmStrategy.order);
const softOrder = order(softStrategy.order);
const addresses = manifest.addresses;
const registry: any = new ethersLibrary.Contract(addresses.registry, [
  "function accept((address maker,address taker,address executor,address swapRouter,bytes32 orderHash,address tokenIn,address tokenOut,uint256 amountIn,uint256 referenceAmountOut,uint256 minAmountOut,uint256 requiredBond,address premiumToken,uint256 premiumAmount,uint32 pricingVersion,uint256 sigmaWad,uint256 annualCapitalRateWad,uint16 capacityKBps,uint256 utilizationAfterWad,uint256 minPremiumOut,uint32 pricingTtl,uint64 expiry,uint256 nonce),(address maker,uint256 traits,bytes data),bytes) returns (bytes32)",
  "function quoteDigest((address maker,address taker,address executor,address swapRouter,bytes32 orderHash,address tokenIn,address tokenOut,uint256 amountIn,uint256 referenceAmountOut,uint256 minAmountOut,uint256 requiredBond,address premiumToken,uint256 premiumAmount,uint32 pricingVersion,uint256 sigmaWad,uint256 annualCapitalRateWad,uint16 capacityKBps,uint256 utilizationAfterWad,uint256 minPremiumOut,uint32 pricingTtl,uint64 expiry,uint256 nonce)) view returns (bytes32)",
  "function utilizationAfter(address,uint256) view returns (uint256)",
  "function expire(bytes32)",
], provider);
const router: any = new ethersLibrary.Contract(addresses.firmRouter, [
  "function quote((address maker,uint256 traits,bytes data),uint256,bytes) view returns (uint256,uint256,bytes32)",
  "function swap((address maker,uint256 traits,bytes data),uint256,bytes) returns (uint256,uint256,bytes32)",
], provider);
const executor: any = new ethersLibrary.Contract(addresses.executor, ["function execute(bytes32,(address maker,uint256 traits,bytes data)) returns (uint8,uint256)"], provider);
const weth: any = new ethersLibrary.Contract(addresses.weth, ["function deposit() payable", "function approve(address,uint256) returns (bool)"], provider);
const usdc: any = new ethersLibrary.Contract(addresses.usdc, ["function balanceOf(address) view returns (uint256)"], provider);

await (await weth.connect(trader).deposit({ value: ethersLibrary.parseEther("5") })).wait();
await (await weth.connect(trader).approve(addresses.registry, ethersLibrary.MaxUint256)).wait();
await (await weth.connect(trader).approve(addresses.executor, ethersLibrary.MaxUint256)).wait();
const amountIn = BigInt(firmStrategy.suggestedAmountIn);
const aquaAcceptance = await accept(1n);
const bondAcceptance = await accept(2n);
const expiryAcceptance = await accept(3n);

const aquaTx = await executor.connect(trader).execute(aquaAcceptance.commitmentId, firmOrder);
const aquaReceipt = await aquaTx.wait();
if (!aquaReceipt || aquaReceipt.status !== 1) throw new Error("Aqua rehearsal execution failed");

const makerInventory = BigInt(await usdc.balanceOf(maker.address));
if (makerInventory <= bondAcceptance.minAmountOut) throw new Error("Maker inventory is already below the accepted output");
const drainTarget = makerInventory - bondAcceptance.minAmountOut + 1n;
const drainAmountIn = await findSoftInput(drainTarget);
await (await weth.connect(drainer).deposit({ value: drainAmountIn })).wait();
await (await weth.connect(drainer).approve(addresses.firmRouter, drainAmountIn)).wait();
const drainTx = await router.connect(drainer).swap(softOrder, drainAmountIn, softStrategy.takerTraits);
const drainReceipt = await drainTx.wait();
if (!drainReceipt || drainReceipt.status !== 1) throw new Error("Sibling Soft drain failed");

const bondTx = await executor.connect(trader).execute(bondAcceptance.commitmentId, firmOrder);
const bondReceipt = await bondTx.wait();
if (!bondReceipt || bondReceipt.status !== 1) throw new Error("Bond rehearsal execution failed");
await networkProvider.request({ method: "evm_increaseTime", params: [121] });
await networkProvider.request({ method: "evm_mine", params: [] });
const expiryTx = await registry.connect(trader).expire(expiryAcceptance.commitmentId);
const expiryReceipt = await expiryTx.wait();
if (!expiryReceipt || expiryReceipt.status !== 1) throw new Error("Expiry rehearsal settlement failed");

const [aquaProof, bondProof, expiryProof] = await Promise.all([
  receipt(aquaAcceptance, aquaTx.hash), receipt(bondAcceptance, bondTx.hash), receipt(expiryAcceptance, expiryTx.hash),
]);
if (aquaProof.path !== "AQUA" || aquaProof.finalState !== "FILLED_AQUA") throw new Error("SDK did not reconstruct FILLED_AQUA");
if (bondProof.path !== "BOND" || bondProof.finalState !== "FILLED_BOND") throw new Error("SDK did not reconstruct FILLED_BOND");
if (expiryProof.path !== "EXPIRED" || expiryProof.finalState !== "EXPIRED") throw new Error("SDK did not reconstruct EXPIRED");
console.log(JSON.stringify({
  rehearsal: "SEPOLIA_FORK_VERIFIED",
  chainId: Number(SEPOLIA_CHAIN_ID),
  deploymentBlock: manifest.deployment.blockNumber,
  trader: traderAddress,
  drainer: drainerAddress,
  paths: [aquaProof.finalState, bondProof.finalState, expiryProof.finalState],
  transactions: { aqua: aquaTx.hash, softDrain: drainTx.hash, bond: bondTx.hash, expiry: expiryTx.hash },
}, null, 2));

async function accept(nonceOffset: bigint) {
  const block = await provider.getBlock("latest");
  if (!block) throw new Error("Latest fork block is unavailable");
  const quoted = await router.quote(softOrder, amountIn, softStrategy.takerTraits);
  if (quoted[0] !== amountIn || String(quoted[2]).toLowerCase() !== softStrategy.orderHash.toLowerCase()) throw new Error("Soft reference quote mismatch");
  const minAmountOut = BigInt(quoted[1]);
  const requiredBond = (minAmountOut * 12_000n + 9_999n) / 10_000n;
  const utilizationAfterWad = await registry.utilizationAfter(maker.address, requiredBond);
  const nonce = BigInt(ethersLibrary.keccak256(ethersLibrary.solidityPacked(["uint256", "uint256", "address"], [block.number, nonceOffset, traderAddress])));
  const quote = buildFirmQuote({
    maker: maker.address, taker: traderAddress, executor: addresses.executor, swapRouter: addresses.firmRouter,
    orderHash: firmStrategy.orderHash, tokenIn: addresses.weth, tokenOut: addresses.usdc,
    amountIn, referenceAmountOut: minAmountOut, minAmountOut, requiredBond, premiumToken: addresses.weth,
    sigmaWad: BigInt(manifest.policies.sigmaWad), annualCapitalRateWad: BigInt(manifest.policies.annualCapitalRateWad),
    capacityKBps: manifest.policies.capacityKBps, utilizationAfterWad, minPremiumOut: BigInt(manifest.policies.minPremiumOut),
    expiry: BigInt(block.timestamp + 120), nonce,
  }, BigInt(block.timestamp));
  const signature = await signFirmQuote(makerViem, addresses.registry, Number(SEPOLIA_CHAIN_ID), quote);
  const commitmentId = await registry.quoteDigest(quote);
  const transaction = await registry.connect(trader).accept(quote, firmOrder, signature);
  const acceptedReceipt = await transaction.wait();
  if (!acceptedReceipt || acceptedReceipt.status !== 1) throw new Error("Fork acceptance failed");
  return { commitmentId, acceptanceHash: transaction.hash, minAmountOut };
}

async function findSoftInput(targetOutput: bigint): Promise<bigint> {
  let low = 1n;
  let high = ethersLibrary.parseEther("1000");
  let match: bigint | null = null;
  for (let iteration = 0; iteration < 192 && low <= high; iteration += 1) {
    const middle = (low + high) / 2n;
    try {
      const quoted = await router.quote(softOrder, middle, softStrategy.takerTraits);
      if (BigInt(quoted[1]) >= targetOutput) { match = middle; high = middle - 1n; }
      else low = middle + 1n;
    } catch { high = middle - 1n; }
  }
  if (match === null) throw new Error("Soft strategy cannot drain enough shared inventory for the Bond rehearsal");
  return match;
}

function receipt(acceptance: { commitmentId: string; acceptanceHash: string }, terminalHash: string) {
  return getFirmExecutionReceipt(viemClient as never, {
    registry: addresses.registry, executor: addresses.executor, router: addresses.firmRouter, vault: addresses.bondVault,
    commitmentId: acceptance.commitmentId as `0x${string}`, acceptanceTransactionHash: acceptance.acceptanceHash as `0x${string}`, terminalTransactionHash: terminalHash as `0x${string}`,
  });
}

function order(value: { maker: string; traits: string; data: string }) {
  return { maker: ethersLibrary.getAddress(value.maker), traits: BigInt(value.traits), data: value.data as `0x${string}` };
}

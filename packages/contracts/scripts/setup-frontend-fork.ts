import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { network } from "hardhat";
import { ethers as ethersLibrary } from "ethers";
import { buildFirmQuoteTakerTraits } from "../../sdk/dist/swapvm.js";
import {
  BASE_AQUA,
  BASE_FORK_BLOCK,
  BASE_SWAP_VM,
  BASE_USDC,
  BASE_WETH,
  buildAquaOrder,
  buildSoftTakerTraits,
  encodeAquaStrategy,
  fundFromImpersonatedHolder,
} from "./lib/base-fork.ts";

const FIRM_PROGRAM = "0x52002100";
const AMOUNT_IN = ethersLibrary.parseEther("0.1");
const AMOUNT_OUT = 200_000_000n;
const FIRM_VIRTUAL_OUTPUT = 3_000_000_000n;
const BOND_DEPOSIT = 1_000_000_000n;
const MAKER_FUNDING = 20_000_000_000n;
const RETAINED_OUTPUT = 100_000_000n;
const MIN_PREMIUM_OUT = 100_000n;

const firmQuoteTypes = {
  FirmQuote: [
    { name: "maker", type: "address" }, { name: "taker", type: "address" },
    { name: "executor", type: "address" }, { name: "swapRouter", type: "address" },
    { name: "orderHash", type: "bytes32" }, { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" },
    { name: "referenceAmountOut", type: "uint256" }, { name: "minAmountOut", type: "uint256" },
    { name: "requiredBond", type: "uint256" }, { name: "premiumToken", type: "address" },
    { name: "premiumAmount", type: "uint256" }, { name: "pricingVersion", type: "uint32" },
    { name: "sigmaWad", type: "uint256" }, { name: "annualCapitalRateWad", type: "uint256" },
    { name: "capacityKBps", type: "uint16" }, { name: "utilizationAfterWad", type: "uint256" },
    { name: "minPremiumOut", type: "uint256" }, { name: "pricingTtl", type: "uint32" },
    { name: "expiry", type: "uint64" }, { name: "nonce", type: "uint256" },
  ],
} as const;

const { ethers } = await network.create();
const provider = ethers.provider;
const [owner, maker, trader, drainer] = await ethers.getSigners();
if (!owner || !maker || !trader || !drainer) throw new Error("Frontend fork setup requires four unlocked accounts");
const chain = await provider.getNetwork();
if (chain.chainId !== 8453n) throw new Error(`Expected Base chain 8453, received ${chain.chainId}`);
const [ownerAddress, makerAddress, traderAddress, drainerAddress] = await Promise.all([owner.getAddress(), maker.getAddress(), trader.getAddress(), drainer.getAddress()]);

for (const [name, address] of Object.entries({ aqua: BASE_AQUA, swapVm: BASE_SWAP_VM, weth: BASE_WETH, usdc: BASE_USDC })) {
  if (await provider.getCode(address) === "0x") throw new Error(`${name} has no code at the pinned fork block`);
}

const usdc = new ethers.Contract(BASE_USDC, [
  "function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)",
], provider);
const weth = new ethers.Contract(BASE_WETH, ["function deposit() payable", "function approve(address,uint256) returns (bool)"], provider);
const aqua = new ethers.Contract(BASE_AQUA, ["function ship(address,bytes,address[],uint256[]) returns (bytes32)"], provider);

await fundFromImpersonatedHolder(provider as never, usdc, makerAddress, MAKER_FUNDING, BASE_FORK_BLOCK);
const vault = await ethers.deployContract("BondVault", [BASE_USDC, ownerAddress]);
await vault.waitForDeployment();
const registry = await ethers.deployContract("FirmCommitmentRegistry", [await vault.getAddress(), BASE_WETH, BASE_USDC, ownerAddress, 300]);
await registry.waitForDeployment();
const router = await ethers.deployContract("FirmAquaSwapVMRouter", [BASE_AQUA, BASE_WETH, ownerAddress, await registry.getAddress(), await vault.getAddress()]);
await router.waitForDeployment();
const executor = await ethers.deployContract("FirmExecutor", [await registry.getAddress(), BASE_AQUA, await router.getAddress()]);
await executor.waitForDeployment();
await (await vault.setRegistry(await registry.getAddress())).wait();
await (await registry.setExecutor(await executor.getAddress())).wait();
await (await usdc.connect(maker).approve(await vault.getAddress(), ethers.MaxUint256)).wait();
await (await vault.connect(maker).deposit(BOND_DEPOSIT)).wait();
await (await usdc.connect(maker).approve(BASE_AQUA, ethers.MaxUint256)).wait();
await (await weth.connect(trader).deposit({ value: ethers.parseEther("2") })).wait();
await (await weth.connect(drainer).deposit({ value: ethers.parseEther("2") })).wait();

const firmOrder = buildAquaOrder(makerAddress, BASE_WETH, BASE_USDC, FIRM_PROGRAM);
const firmOrderHash = await router.hash(firmOrder);
await (await aqua.connect(maker).ship(await router.getAddress(), encodeAquaStrategy(firmOrder), [BASE_WETH, BASE_USDC], [0n, FIRM_VIRTUAL_OUTPUT])).wait();

const softProgram = ethers.concat(["0x5000", "0x0208", ethers.toBeHex(77, 8)]);
const softOrder = buildAquaOrder(makerAddress, BASE_WETH, BASE_USDC, softProgram);
const softOrderHash = await router.hash(softOrder);
const softOutput = BigInt(await usdc.balanceOf(makerAddress)) - RETAINED_OUTPUT;
await (await aqua.connect(maker).ship(await router.getAddress(), encodeAquaStrategy(softOrder), [BASE_WETH, BASE_USDC], [0n, softOutput])).wait();

const latest = await provider.getBlock("latest");
if (!latest) throw new Error("Latest fork block is unavailable");
const utilizationAfterWad = await registry.utilizationAfter(makerAddress, AMOUNT_OUT);
const quote = {
  maker: makerAddress, taker: traderAddress, executor: await executor.getAddress(), swapRouter: await router.getAddress(),
  orderHash: firmOrderHash, tokenIn: BASE_WETH, tokenOut: BASE_USDC, amountIn: AMOUNT_IN,
  referenceAmountOut: AMOUNT_OUT, minAmountOut: AMOUNT_OUT, requiredBond: AMOUNT_OUT,
  premiumToken: BASE_WETH, premiumAmount: 0n, pricingVersion: 2, sigmaWad: 0n,
  annualCapitalRateWad: 0n, capacityKBps: 0, utilizationAfterWad, minPremiumOut: MIN_PREMIUM_OUT,
  pricingTtl: 300, expiry: BigInt(latest.timestamp + 300), nonce: 1n,
};
quote.premiumAmount = (await registry.quotePremium(quote)).premiumIn;
const domain = { name: "FirmDepth", version: "1", chainId: 8453, verifyingContract: await registry.getAddress() };
const makerSignature = await maker.signTypedData(domain, firmQuoteTypes, quote);
if (ethers.verifyTypedData(domain, firmQuoteTypes, quote, makerSignature) !== makerAddress) throw new Error("Firm quote signature mismatch");
const firmTakerTraits = buildFirmQuoteTakerTraits({ amountOut: AMOUNT_OUT, tokenIn: BASE_WETH, tokenOut: BASE_USDC, deadline: quote.expiry });
const softTakerTraits = buildSoftTakerTraits(BASE_WETH, BASE_USDC);
const deploymentBlock = await provider.getBlockNumber();

const artifact = {
  schemaVersion: "1", chainId: 8453, networkName: "Pinned Base fork", forkBlock: BASE_FORK_BLOCK,
  createdAt: new Date().toISOString(), rpcUrl: process.env.FIRMDEPTH_FORK_RPC_URL ?? "http://127.0.0.1:8545", deploymentBlock,
  sourceRevisions: { aqua: "9c5c42e5840e8741fba3597c48456c9510212b66", swapVM: "f09a41e689240adc645934f965c8061749397cd2", aquaSDK: "364e7155167957e6a24320c7beb90539e06c91eb" },
  addresses: { aqua: BASE_AQUA, weth: BASE_WETH, usdc: BASE_USDC, bondVault: await vault.getAddress(), registry: await registry.getAddress(), firmRouter: await router.getAddress(), executor: await executor.getAddress() },
  opcodeConfiguration: { firmPrice: 0x52, firmGuard: 0x21, program: FIRM_PROGRAM }, pricingPolicy: { version: 2, maxQuoteTtl: 300 },
  accounts: { owner: ownerAddress, maker: makerAddress, trader: traderAddress, drainer: drainerAddress },
  strategies: [
    { id: "soft-drain", label: "Shared inventory drain", kind: "SOFT", order: firmOrderJson(softOrder), orderHash: softOrderHash, takerTraits: softTakerTraits, amountIn: ethers.parseEther("1").toString(), expectedAmountOut: softOutput.toString() },
    { id: "firm-primary", label: "Bond-backed exact input", kind: "FIRM", order: firmOrderJson(firmOrder), orderHash: firmOrderHash, takerTraits: firmTakerTraits, amountIn: AMOUNT_IN.toString(), expectedAmountOut: AMOUNT_OUT.toString(), firm: { quote: serializeBigInts(quote), makerSignature } },
  ],
};
const outputDirectory = resolve(process.cwd(), "../frontend/.runtime");
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "firmdepth.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: resolve(outputDirectory, "firmdepth.json"), deploymentBlock, accounts: artifact.accounts, addresses: artifact.addresses }, null, 2));

function firmOrderJson(order: { maker: string; traits: bigint; data: string }) {
  return { maker: order.maker, traits: order.traits.toString(), data: order.data };
}

function serializeBigInts<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T;
}

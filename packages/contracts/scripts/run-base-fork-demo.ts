import { mkdir, writeFile } from "node:fs/promises";
import { network } from "hardhat";
import { ethers as ethersLibrary } from "ethers";

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
const MIN_PREMIUM_OUT = 100_000n;

const firmQuoteTypes = {
  FirmQuote: [
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "executor", type: "address" },
    { name: "swapRouter", type: "address" },
    { name: "orderHash", type: "bytes32" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "referenceAmountOut", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "requiredBond", type: "uint256" },
    { name: "premiumToken", type: "address" },
    { name: "premiumAmount", type: "uint256" },
    { name: "pricingVersion", type: "uint32" },
    { name: "sigmaWad", type: "uint256" },
    { name: "annualCapitalRateWad", type: "uint256" },
    { name: "capacityKBps", type: "uint16" },
    { name: "utilizationAfterWad", type: "uint256" },
    { name: "minPremiumOut", type: "uint256" },
    { name: "pricingTtl", type: "uint32" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const { ethers } = await network.create();
const provider = ethers.provider;
const [owner, maker, trader, drainer] = await ethers.getSigners();
if (owner === undefined || maker === undefined || trader === undefined || drainer === undefined) {
  throw new Error("Base fork demo requires four funded Hardhat accounts");
}

const [ownerAddress, makerAddress, traderAddress, drainerAddress] = await Promise.all([
  owner.getAddress(),
  maker.getAddress(),
  trader.getAddress(),
  drainer.getAddress(),
]);
const officialBytecodes = Object.fromEntries(await Promise.all(Object.entries({
  aqua: BASE_AQUA,
  swapVm: BASE_SWAP_VM,
  weth: BASE_WETH,
  usdc: BASE_USDC,
}).map(async ([name, address]) => {
  const code = await provider.getCode(address);
  if (code === "0x") throw new Error(`${name} has no bytecode at pinned Base block`);
  return [name, (code.length - 2) / 2];
})));
const usdc = new ethers.Contract(BASE_USDC, [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
], provider);
const weth = new ethers.Contract(BASE_WETH, [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function deposit() payable",
], provider);
const aqua = new ethers.Contract(BASE_AQUA, [
  "function ship(address,bytes,address[],uint256[]) returns (bytes32)",
  "function rawBalances(address,address,bytes32,address) view returns (uint248,uint8)",
], provider);

const funding = await fundFromImpersonatedHolder(
  provider as never,
  usdc,
  makerAddress,
  MAKER_FUNDING,
  BASE_FORK_BLOCK,
);

const vault = await ethers.deployContract("BondVault", [BASE_USDC, ownerAddress]);
await vault.waitForDeployment();
const registry = await ethers.deployContract("FirmCommitmentRegistry", [
  await vault.getAddress(),
  BASE_WETH,
  BASE_USDC,
  ownerAddress,
  300,
]);
await registry.waitForDeployment();
const router = await ethers.deployContract("FirmAquaSwapVMRouter", [
  BASE_AQUA,
  BASE_WETH,
  ownerAddress,
  await registry.getAddress(),
  await vault.getAddress(),
]);
await router.waitForDeployment();
const executor = await ethers.deployContract("FirmExecutor", [
  await registry.getAddress(),
  BASE_AQUA,
  await router.getAddress(),
]);
await executor.waitForDeployment();

const configurationTransactions = [
  await (await vault.setRegistry(await registry.getAddress())).wait(),
  await (await registry.setExecutor(await executor.getAddress())).wait(),
];
const makerTransactions = [
  await (await usdc.connect(maker).approve(await vault.getAddress(), ethers.MaxUint256)).wait(),
  await (await vault.connect(maker).deposit(BOND_DEPOSIT)).wait(),
  await (await usdc.connect(maker).approve(BASE_AQUA, ethers.MaxUint256)).wait(),
];
const traderTransactions = [
  await (await weth.connect(trader).deposit({ value: ethers.parseEther("1") })).wait(),
  await (await weth.connect(trader).approve(await registry.getAddress(), ethers.MaxUint256)).wait(),
  await (await weth.connect(trader).approve(await executor.getAddress(), ethers.MaxUint256)).wait(),
];

const firmOrder = buildAquaOrder(makerAddress, BASE_WETH, BASE_USDC, FIRM_PROGRAM);
const firmOrderHash = await router.hash(firmOrder);
const shipFirm = await aqua.connect(maker).ship(
  await router.getAddress(),
  encodeAquaStrategy(firmOrder),
  [BASE_WETH, BASE_USDC],
  [0n, FIRM_VIRTUAL_OUTPUT],
);
const shipFirmReceipt = await shipFirm.wait();

const domain = {
  name: "FirmDepth",
  version: "1",
  chainId: 8453,
  verifyingContract: await registry.getAddress(),
};

async function buildSignedQuote(nonce: bigint) {
  const latestBlock = await provider.getBlock("latest");
  if (latestBlock === null) throw new Error("Missing latest block");
  const utilizationAfterWad = await registry.utilizationAfter(makerAddress, AMOUNT_OUT);
  const quote = {
    maker: makerAddress,
    taker: traderAddress,
    executor: await executor.getAddress(),
    swapRouter: await router.getAddress(),
    orderHash: firmOrderHash,
    tokenIn: BASE_WETH,
    tokenOut: BASE_USDC,
    amountIn: AMOUNT_IN,
    referenceAmountOut: AMOUNT_OUT,
    minAmountOut: AMOUNT_OUT,
    requiredBond: AMOUNT_OUT,
    premiumToken: BASE_WETH,
    premiumAmount: 0n,
    pricingVersion: 2,
    sigmaWad: 0n,
    annualCapitalRateWad: 0n,
    capacityKBps: 0,
    utilizationAfterWad,
    minPremiumOut: MIN_PREMIUM_OUT,
    pricingTtl: 240,
    expiry: BigInt(latestBlock.timestamp + 240),
    nonce,
  };
  const pricing = await registry.quotePremium(quote);
  quote.premiumAmount = pricing.premiumIn;
  const signature = await maker.signTypedData(domain, firmQuoteTypes, quote);
  const recovered = ethers.verifyTypedData(domain, firmQuoteTypes, quote, signature);
  assertEqual(recovered, makerAddress, "typed-data signer");
  return { quote, signature };
}

async function accept(nonce: bigint) {
  const signed = await buildSignedQuote(nonce);
  const commitmentId = await registry.quoteDigest(signed.quote);
  const transaction = await registry.connect(trader).accept(signed.quote, firmOrder, signed.signature);
  const receipt = await transaction.wait();
  const commitment = await registry.getCommitment(commitmentId);
  assertEqual(commitment.status, 1n, "accepted commitment status");
  return { ...signed, commitmentId, receipt };
}

const aquaAcceptance = await accept(1n);
const aquaBalancesBefore = await balances(makerAddress, traderAddress);
const aquaExecution = await executor.connect(trader).execute(aquaAcceptance.commitmentId, firmOrder);
const aquaExecutionReceipt = await aquaExecution.wait();
const aquaBalancesAfter = await balances(makerAddress, traderAddress);
const aquaCommitment = await registry.getCommitment(aquaAcceptance.commitmentId);
assertEqual(aquaCommitment.status, 2n, "Aqua terminal status");
assertEqual(aquaBalancesAfter.traderUsdc - aquaBalancesBefore.traderUsdc, AMOUNT_OUT, "Aqua trader output");
assertEqual(aquaBalancesBefore.traderWeth - aquaBalancesAfter.traderWeth, AMOUNT_IN, "Aqua trader input");
assertEqual(
  aquaBalancesAfter.makerWeth - aquaBalancesBefore.makerWeth,
  AMOUNT_IN + aquaAcceptance.quote.premiumAmount,
  "Aqua maker input and premium",
);
assertEqual(aquaBalancesBefore.makerUsdc - aquaBalancesAfter.makerUsdc, AMOUNT_OUT, "Aqua maker output");
assertEqual(BigInt(await weth.balanceOf(await registry.getAddress())), 0n, "Aqua premium settlement");

const bondAcceptance = await accept(2n);
const expiredAcceptance = await accept(3n);
const failureAcceptance = await accept(4n);
const makerUsdcBeforeDrain = BigInt(await usdc.balanceOf(makerAddress));
const retainedMakerOutput = 100_000_000n;
const drainOutput = makerUsdcBeforeDrain - retainedMakerOutput;
if (drainOutput <= 0n) throw new Error("Maker has insufficient live USDC to run the drain scenario");
const softProgram = ethers.concat(["0x5000", "0x0208", ethers.toBeHex(77, 8)]);
const softOrder = buildAquaOrder(makerAddress, BASE_WETH, BASE_USDC, softProgram);
const softOrderHash = await router.hash(softOrder);
const siblingSoftProgram = ethers.concat(["0x5000", "0x0208", ethers.toBeHex(78, 8)]);
const siblingSoftOrder = buildAquaOrder(makerAddress, BASE_WETH, BASE_USDC, siblingSoftProgram);
const siblingSoftOrderHash = await router.hash(siblingSoftOrder);
const shipSoft = await aqua.connect(maker).ship(
  await router.getAddress(),
  encodeAquaStrategy(softOrder),
  [BASE_WETH, BASE_USDC],
  [0n, drainOutput],
);
const shipSoftReceipt = await shipSoft.wait();
const shipSiblingSoft = await aqua.connect(maker).ship(
  await router.getAddress(),
  encodeAquaStrategy(siblingSoftOrder),
  [BASE_WETH, BASE_USDC],
  [0n, drainOutput],
);
const shipSiblingSoftReceipt = await shipSiblingSoft.wait();
await (await weth.connect(drainer).deposit({ value: ethers.parseEther("1") })).wait();
await (await weth.connect(drainer).approve(await router.getAddress(), ethers.MaxUint256)).wait();
const softSwap = await router.connect(drainer).swap(
  softOrder,
  ethers.parseEther("1"),
  buildSoftTakerTraits(BASE_WETH, BASE_USDC),
);
const softSwapReceipt = await softSwap.wait();
assertEqual(BigInt(await usdc.balanceOf(makerAddress)), retainedMakerOutput, "post-drain maker output");

await (await weth.connect(drainer).deposit({ value: ethers.parseEther("1") })).wait();
const failedSoftBalancesBefore = await balances(makerAddress, drainerAddress);
const failedSoftTransaction = await drainer.sendTransaction({
  to: await router.getAddress(),
  data: router.interface.encodeFunctionData("swap", [
    siblingSoftOrder,
    ethers.parseEther("1"),
    buildSoftTakerTraits(BASE_WETH, BASE_USDC),
  ]),
  gasLimit: 2_000_000,
});
let failedSoftReceipt;
try {
  failedSoftReceipt = await failedSoftTransaction.wait();
} catch (error) {
  failedSoftReceipt = extractReceipt(error);
}
if (failedSoftReceipt === null || failedSoftReceipt.status !== 0) {
  throw new Error("Depleted sibling Soft transaction did not revert");
}
const failedSoftBalancesAfter = await balances(makerAddress, drainerAddress);
assertEqual(failedSoftBalancesAfter.makerWeth, failedSoftBalancesBefore.makerWeth, "failed Soft maker input");
assertEqual(failedSoftBalancesAfter.makerUsdc, failedSoftBalancesBefore.makerUsdc, "failed Soft maker output");
assertEqual(failedSoftBalancesAfter.traderWeth, failedSoftBalancesBefore.traderWeth, "failed Soft taker input");
assertEqual(failedSoftBalancesAfter.traderUsdc, failedSoftBalancesBefore.traderUsdc, "failed Soft taker output");

const capacityAfterDrain = await executor.capacity(bondAcceptance.commitmentId);
assertEqual(capacityAfterDrain.effectiveCapacity, retainedMakerOutput, "post-drain effective capacity");
const bondBalancesBefore = await balances(makerAddress, traderAddress);
const bondExecution = await executor.connect(trader).execute(bondAcceptance.commitmentId, firmOrder);
const bondExecutionReceipt = await bondExecution.wait();
const bondBalancesAfter = await balances(makerAddress, traderAddress);
const bondCommitment = await registry.getCommitment(bondAcceptance.commitmentId);
assertEqual(bondCommitment.status, 3n, "bond terminal status");
assertEqual(bondBalancesAfter.traderUsdc - bondBalancesBefore.traderUsdc, AMOUNT_OUT, "bond trader output");
assertEqual(
  bondBalancesBefore.traderWeth - bondBalancesAfter.traderWeth,
  AMOUNT_IN,
  "bond trader execution input",
);
assertEqual(
  bondBalancesAfter.makerWeth - bondBalancesBefore.makerWeth,
  AMOUNT_IN + bondAcceptance.quote.premiumAmount,
  "bond maker input and premium",
);
assertEqual(bondBalancesAfter.makerUsdc, bondBalancesBefore.makerUsdc, "bond maker output");
assertEqual(BigInt(await weth.balanceOf(await registry.getAddress())), expiredAcceptance.quote.premiumAmount + failureAcceptance.quote.premiumAmount, "outstanding accepted premium escrow");

const failureLockBefore = await vault.lockedFor(failureAcceptance.commitmentId);
const executorAddress = await executor.getAddress();
const executorCode = await provider.getCode(executorAddress);
await provider.send("hardhat_setCode", [executorAddress, "0x60006000fd"]);
const failureTransaction = await trader.sendTransaction({
  to: executorAddress,
  data: executor.interface.encodeFunctionData("execute", [failureAcceptance.commitmentId, firmOrder]),
  gasLimit: 2_000_000,
});
let failureReceipt;
try { failureReceipt = await failureTransaction.wait(); } catch (error) { failureReceipt = extractReceipt(error); }
if (failureReceipt === null || failureReceipt.status !== 0) throw new Error("Unrelated Firm executor failure did not revert");
await provider.send("hardhat_setCode", [executorAddress, executorCode]);
const failureLockAfter = await vault.lockedFor(failureAcceptance.commitmentId);
const failureCommitment = await registry.getCommitment(failureAcceptance.commitmentId);
assertEqual(failureCommitment.status, 1n, "unrelated failure commitment status");
assertEqual(failureLockAfter.amount, failureLockBefore.amount, "unrelated failure bond lock");

await provider.send("evm_increaseTime", [241]);
await provider.send("evm_mine", []);
const expiredBalancesBefore = await balances(makerAddress, traderAddress);
const expiredLockBefore = await vault.lockedFor(expiredAcceptance.commitmentId);
const expireTransaction = await registry.expire(expiredAcceptance.commitmentId);
const expireReceipt = await expireTransaction.wait();
const expiredBalancesAfter = await balances(makerAddress, traderAddress);
const expiredLockAfter = await vault.lockedFor(expiredAcceptance.commitmentId);
const expiredCommitment = await registry.getCommitment(expiredAcceptance.commitmentId);
assertEqual(expiredCommitment.status, 4n, "expired terminal status");
assertEqual(expiredLockAfter.amount, 0n, "expired bond unlock");
assertEqual(expiredBalancesAfter.makerWeth - expiredBalancesBefore.makerWeth, expiredAcceptance.quote.premiumAmount, "expired premium paid to maker");
assertEqual(expiredBalancesAfter.traderUsdc, expiredBalancesBefore.traderUsdc, "expired principal output");
await (await registry.expire(failureAcceptance.commitmentId)).wait();
assertEqual(BigInt(await weth.balanceOf(await registry.getAddress())), 0n, "terminal premium settlement");
assertEqual(BigInt(await vault.totalLocked()), 0n, "terminal vault locks");
assertEqual(BigInt(await usdc.balanceOf(await vault.getAddress())), BigInt(await vault.liabilities()), "vault reconciliation");

const rejected = await buildSignedQuote(5n);
let rejectionData = "";
try {
  await registry.connect(trader).accept.staticCall(rejected.quote, firmOrder, rejected.signature);
  throw new Error("Capacity-depleted Firm quote was unexpectedly accepted");
} catch (error) {
  rejectionData = extractRevertData(error);
  if (!rejectionData.startsWith(ethers.id("IneligibleAquaCapacity(uint256,uint256)").slice(0, 10))) {
    throw error;
  }
}

const evidence = {
  schemaVersion: "1",
  chainId: 8453,
  forkBlock: BASE_FORK_BLOCK,
  officialContracts: { aqua: BASE_AQUA, swapVm: BASE_SWAP_VM, weth: BASE_WETH, usdc: BASE_USDC },
  officialBytecodeBytes: officialBytecodes,
  forkSetup: {
    localHistoricalHolderImpersonation: true,
    publicMainnetTransaction: false,
    canonicalForkEvidence: true,
  },
  funding: { holder: funding.holder, transactionHash: funding.transactionHash, amount: MAKER_FUNDING.toString() },
  deployedContracts: {
    vault: await vault.getAddress(),
    registry: await registry.getAddress(),
    router: await router.getAddress(),
    executor: await executor.getAddress(),
  },
  setupTransactionHashes: [
    ...configurationTransactions,
    ...makerTransactions,
    ...traderTransactions,
    shipFirmReceipt,
  ].map(transactionHash),
  aquaPath: {
    commitmentId: aquaAcceptance.commitmentId,
    acceptanceTransactionHash: transactionHash(aquaAcceptance.receipt),
    executionTransactionHash: transactionHash(aquaExecutionReceipt),
    acceptanceGasUsed: aquaAcceptance.receipt.gasUsed.toString(),
    executionGasUsed: aquaExecutionReceipt.gasUsed.toString(),
    terminalStatus: Number(aquaCommitment.status),
    traderInputDelta: (aquaBalancesBefore.traderWeth - aquaBalancesAfter.traderWeth).toString(),
    traderOutputDelta: (aquaBalancesAfter.traderUsdc - aquaBalancesBefore.traderUsdc).toString(),
    premiumPaidToMaker: aquaAcceptance.quote.premiumAmount.toString(),
  },
  sharedLiquidityDrain: {
    orderHash: softOrderHash,
    siblingOrderHash: siblingSoftOrderHash,
    shipTransactionHash: transactionHash(shipSoftReceipt),
    siblingShipTransactionHash: transactionHash(shipSiblingSoftReceipt),
    swapTransactionHash: transactionHash(softSwapReceipt),
    swapGasUsed: softSwapReceipt.gasUsed.toString(),
    failedSiblingTransactionHash: transactionHash(failedSoftReceipt),
    failedSiblingGasUsed: failedSoftReceipt.gasUsed.toString(),
    failedSiblingStatus: failedSoftReceipt.status,
    failedSiblingAtomic: true,
    makerOutputBalanceAfter: retainedMakerOutput.toString(),
    firmEffectiveCapacityAfter: capacityAfterDrain.effectiveCapacity.toString(),
  },
  bondPath: {
    commitmentId: bondAcceptance.commitmentId,
    acceptanceTransactionHash: transactionHash(bondAcceptance.receipt),
    executionTransactionHash: transactionHash(bondExecutionReceipt),
    acceptanceGasUsed: bondAcceptance.receipt.gasUsed.toString(),
    executionGasUsed: bondExecutionReceipt.gasUsed.toString(),
    terminalStatus: Number(bondCommitment.status),
    grossTraderInputAmount: AMOUNT_IN.toString(),
    premiumPaidToMaker: bondAcceptance.quote.premiumAmount.toString(),
    netTraderInputDelta: (bondBalancesBefore.traderWeth - bondBalancesAfter.traderWeth).toString(),
    traderOutputDelta: (bondBalancesAfter.traderUsdc - bondBalancesBefore.traderUsdc).toString(),
  },
  expiredPath: {
    commitmentId: expiredAcceptance.commitmentId,
    acceptanceTransactionHash: transactionHash(expiredAcceptance.receipt),
    expiryTransactionHash: transactionHash(expireReceipt),
    terminalStatus: Number(expiredCommitment.status),
    bondLockedBefore: expiredLockBefore.amount.toString(),
    bondLockedAfter: expiredLockAfter.amount.toString(),
    premiumPaidToMaker: expiredAcceptance.quote.premiumAmount.toString(),
    traderPrincipalOutputDelta: (expiredBalancesAfter.traderUsdc - expiredBalancesBefore.traderUsdc).toString(),
  },
  unrelatedFirmFailure: {
    commitmentId: failureAcceptance.commitmentId,
    acceptanceTransactionHash: transactionHash(failureAcceptance.receipt),
    revertedTransactionHash: transactionHash(failureReceipt),
    revertedStatus: failureReceipt.status,
    commitmentStatusAfter: Number(failureCommitment.status),
    bondLockedBefore: failureLockBefore.amount.toString(),
    bondLockedAfter: failureLockAfter.amount.toString(),
  },
  depletedAcceptance: { rejected: true, revertData: rejectionData },
  vault: {
    totalLocked: (await vault.totalLocked()).toString(),
    liabilities: (await vault.liabilities()).toString(),
    tokenBalance: (await usdc.balanceOf(await vault.getAddress())).toString(),
  },
};
if (process.env.WRITE_FORK_EVIDENCE === "1") {
  await mkdir("evidence", { recursive: true });
  await writeFile("evidence/base-fork-demo.json", `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(evidence, null, 2));

async function balances(makerAccount: string, traderAccount: string) {
  return {
    makerWeth: BigInt(await weth.balanceOf(makerAccount)),
    makerUsdc: BigInt(await usdc.balanceOf(makerAccount)),
    traderWeth: BigInt(await weth.balanceOf(traderAccount)),
    traderUsdc: BigInt(await usdc.balanceOf(traderAccount)),
  };
}

function transactionHash(receipt: { hash?: string } | null): string {
  if (receipt?.hash === undefined) throw new Error("Missing transaction receipt hash");
  return receipt.hash;
}

function assertEqual(actual: bigint | string, expected: bigint | string, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
}

function extractRevertData(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const record = error as Record<string, unknown>;
  if (typeof record.data === "string") return record.data;
  if (typeof record.error === "object" && record.error !== null) return extractRevertData(record.error);
  return "";
}

function extractReceipt(error: unknown) {
  if (typeof error !== "object" || error === null) return null;
  const record = error as Record<string, unknown>;
  if (typeof record.receipt === "object" && record.receipt !== null) return record.receipt as Awaited<ReturnType<typeof failedSoftTransaction.wait>>;
  if (typeof record.error === "object" && record.error !== null) return extractReceipt(record.error);
  return null;
}

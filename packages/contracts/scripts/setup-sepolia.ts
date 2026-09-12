import { network } from "hardhat";
import type {} from "@nomicfoundation/hardhat-ethers";
import { ethers as ethersLibrary } from "ethers";
import { buildFirmOrder, buildSoftOrder, buildSoftTakerTraits } from "../../sdk/dist/swapvm.js";
import { encodeOrder, FIRM_PROGRAM, readPublicManifest, requiredKey, SEPOLIA_CHAIN_ID, serializeOrder, waitForSuccess, writePublicManifest } from "./lib/public-demo.ts";

const { ethers } = await network.create();
if ((await ethers.provider.getNetwork()).chainId !== SEPOLIA_CHAIN_ID) throw new Error("Maker setup may run only on Sepolia");
const maker = new ethersLibrary.Wallet(requiredKey("MAKER_PRIVATE_KEY"), ethers.provider);
const makerAddress = await maker.getAddress();
const manifest = await readPublicManifest();
if (!["deployed", "ready"].includes(manifest.status)) throw new Error("Record the Sepolia deployment before maker setup");
for (const key of ["aqua", "weth", "usdc", "bondVault", "registry", "firmRouter", "executor"]) if (!ethersLibrary.isAddress(manifest.addresses[key])) throw new Error(`Manifest address ${key} is unavailable`);
if (manifest.maker && ethersLibrary.getAddress(manifest.maker) !== makerAddress) throw new Error("MAKER_PRIVATE_KEY does not match the recorded maker");
if (manifest.deployment.deployer && ethersLibrary.getAddress(manifest.deployment.deployer) === makerAddress) throw new Error("Maker and deployer roles must use distinct addresses");

const FIRM_VIRTUAL = units("FIRM_VIRTUAL_USDC", "3000", 6);
const SOFT_VIRTUAL = units("SOFT_VIRTUAL_USDC", "3000", 6);
const BOND_TARGET = units("BOND_USDC", "1000", 6);
const SUGGESTED_INPUT = units("SUGGESTED_WETH", "0.1", 18);
const addresses = manifest.addresses;
const erc20Abi = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];
const aquaAbi = ["function rawBalances(address,address,bytes32,address) view returns (uint248,uint8)", "function ship(address,bytes,address[],uint256[]) returns (bytes32)", "function push(address,address,bytes32,address,uint256)"];
const vaultAbi = ["function availableOf(address) view returns (uint256)", "function lockedOf(address) view returns (uint256)", "function deposit(uint256)"];
const routerAbi = ["function hash((address maker,uint256 traits,bytes data) order) view returns (bytes32)"];
const usdc = new ethersLibrary.Contract(addresses.usdc, erc20Abi, maker);
const aqua = new ethersLibrary.Contract(addresses.aqua, aquaAbi, maker);
const vault = new ethersLibrary.Contract(addresses.bondVault, vaultAbi, maker);
const router = new ethersLibrary.Contract(addresses.firmRouter, routerAbi, maker);
const firmOrder = buildFirmOrder(makerAddress as `0x${string}`, addresses.weth, addresses.usdc);
const softOrder = buildSoftOrder(makerAddress as `0x${string}`, addresses.weth, addresses.usdc);
const firmHash = await router.hash(firmOrder);
const softHash = await router.hash(softOrder);
const transactions: string[] = [...(manifest.transactions.setup ?? [])];

const [makerUsdc, available, locked] = await Promise.all([usdc.balanceOf(makerAddress), vault.availableOf(makerAddress), vault.lockedOf(makerAddress)]);
const targetInventory = FIRM_VIRTUAL > SOFT_VIRTUAL ? FIRM_VIRTUAL : SOFT_VIRTUAL;
if (makerUsdc + available + locked < targetInventory + BOND_TARGET) throw new Error(`Maker requires at least ${ethersLibrary.formatUnits(targetInventory + BOND_TARGET, 6)} total USDC across wallet and Bond`);
if (await usdc.allowance(makerAddress, addresses.aqua) < targetInventory) transactions.push(await waitForSuccess(await usdc.approve(addresses.aqua, ethersLibrary.MaxUint256)));

await ensureStrategy("Firm", firmOrder, firmHash, FIRM_VIRTUAL);
await ensureStrategy("Soft", softOrder, softHash, SOFT_VIRTUAL);

const currentBond = available + locked;
if (currentBond < BOND_TARGET) {
  const deposit = BOND_TARGET - currentBond;
  if (await usdc.allowance(makerAddress, addresses.bondVault) < deposit) transactions.push(await waitForSuccess(await usdc.approve(addresses.bondVault, ethersLibrary.MaxUint256)));
  transactions.push(await waitForSuccess(await vault.deposit(deposit)));
}

manifest.status = "ready";
manifest.maker = makerAddress;
manifest.strategies = [
  { id: "soft-drain", label: "Shared inventory drain", kind: "SOFT", order: serializeOrder(softOrder), orderHash: softHash, takerTraits: buildSoftTakerTraits(addresses.weth, addresses.usdc), suggestedAmountIn: SUGGESTED_INPUT.toString(), virtualBalances: { weth: "0", usdc: SOFT_VIRTUAL.toString() } },
  { id: "firm-primary", label: "Bond-backed exact input", kind: "FIRM", order: serializeOrder(firmOrder), orderHash: firmHash, takerTraits: "0x", suggestedAmountIn: SUGGESTED_INPUT.toString(), virtualBalances: { weth: "0", usdc: FIRM_VIRTUAL.toString() } },
];
manifest.transactions.setup = [...new Set(transactions)];
await writePublicManifest(manifest);
console.log(JSON.stringify({ status: "ready", maker: makerAddress, firmHash, softHash, firmProgram: FIRM_PROGRAM, newTransactions: transactions.length }, null, 2));

async function ensureStrategy(label: string, order: { maker: string; traits: bigint; data: string }, hash: string, targetOutput: bigint): Promise<void> {
  const [input, output] = await Promise.all([
    aqua.rawBalances(makerAddress, addresses.firmRouter, hash, addresses.weth),
    aqua.rawBalances(makerAddress, addresses.firmRouter, hash, addresses.usdc),
  ]);
  const counts = [Number(input[1]), Number(output[1])];
  if (counts.includes(255)) throw new Error(`${label} strategy is docked and immutable; deploy a new router/order configuration`);
  if (counts.every((value) => value === 0)) {
    transactions.push(await waitForSuccess(await aqua.ship(addresses.firmRouter, encodeOrder(order), [addresses.weth, addresses.usdc], [0n, targetOutput])));
    return;
  }
  if (!counts.every((value) => value === 2)) throw new Error(`${label} strategy has inconsistent Aqua token state`);
  if (BigInt(output[0]) < targetOutput) transactions.push(await waitForSuccess(await aqua.push(makerAddress, addresses.firmRouter, hash, addresses.usdc, targetOutput - BigInt(output[0]))));
}

function units(name: string, fallback: string, decimals: number): bigint {
  const value = process.env[name] ?? fallback;
  const parsed = ethersLibrary.parseUnits(value, decimals);
  if (parsed <= 0n) throw new Error(`${name} must be positive`);
  return parsed;
}

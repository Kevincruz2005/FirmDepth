import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { network } from "hardhat";
import type {} from "@nomicfoundation/hardhat-ethers";
import { ethers as ethersLibrary } from "ethers";
import { manifestPath, readPublicManifest, requiredAddress, requiredKey, SEPOLIA_CHAIN_ID, sourceRevision, writePublicManifest } from "./lib/public-demo.ts";

const { ethers } = await network.create();
const chain = await ethers.provider.getNetwork();
if (chain.chainId !== SEPOLIA_CHAIN_ID) throw new Error(`Expected Sepolia, received chain ${chain.chainId}`);
const deployer = new ethersLibrary.Wallet(requiredKey("SEPOLIA_DEPLOYER_PRIVATE_KEY"));
const configured = {
  aqua: requiredAddress("AQUA_ADDRESS"),
  weth: requiredAddress("WETH_ADDRESS"),
  usdc: requiredAddress("USDC_ADDRESS"),
};
const maxQuoteTtl = Number(process.env.MAX_QUOTE_TTL);
if (maxQuoteTtl !== 120) throw new Error("MAX_QUOTE_TTL must be exactly 120 for the public demo");

const deploymentDirectory = resolve(process.cwd(), "ignition/deployments/chain-11155111");
const deployed = JSON.parse(await readFile(resolve(deploymentDirectory, "deployed_addresses.json"), "utf8"));
const addresses = {
  ...configured,
  bondVault: requiredDeployed(deployed, "FirmDepth#BondVault"),
  registry: requiredDeployed(deployed, "FirmDepth#FirmCommitmentRegistry"),
  firmRouter: requiredDeployed(deployed, "FirmDepth#FirmAquaSwapVMRouter"),
  executor: requiredDeployed(deployed, "FirmDepth#FirmExecutor"),
};
for (const [label, address] of Object.entries(addresses)) if (await ethers.provider.getCode(address) === "0x") throw new Error(`${label} has no Sepolia bytecode`);

const manifest = await readPublicManifest();
if (manifest.status === "ready") throw new Error("Refusing to overwrite a ready public manifest; setup is already recorded");
const hashes = await transactionHashes(deploymentDirectory);
const receipts = await Promise.all(hashes.map((hash) => ethers.provider.getTransactionReceipt(hash)));
const mined = receipts.filter(Boolean);
if (mined.length === 0) throw new Error("No mined Ignition deployment transactions were found");
const deploymentBlock = Math.min(...mined.map((receipt) => receipt!.blockNumber));
const block = await ethers.provider.getBlock(deploymentBlock);
if (!block) throw new Error("Deployment block is unavailable");

Object.assign(manifest, {
  status: "deployed",
  deployment: { blockNumber: deploymentBlock, deployedAt: new Date(block.timestamp * 1000).toISOString(), deployer: deployer.address },
  addresses,
  maker: null,
  strategies: [],
  sourceRevisions: { ...manifest.sourceRevisions, firmDepth: sourceRevision() },
  transactions: { deployment: hashes, setup: [] },
});
await writePublicManifest(manifest);
console.log(JSON.stringify({ manifestPath, status: manifest.status, deploymentBlock, addresses, transactionHashes: hashes }, null, 2));

function requiredDeployed(input: Record<string, string>, key: string): string {
  const value = input[key];
  if (!value) throw new Error(`Ignition address ${key} is missing`);
  return ethersLibrary.getAddress(value);
}

async function transactionHashes(root: string): Promise<string[]> {
  const found = new Set<string>();
  for (const name of await readdir(root, { recursive: true }) as string[]) {
    if (!name.endsWith(".json") && !name.endsWith(".jsonl")) continue;
    const text = await readFile(resolve(root, name), "utf8");
    for (const match of text.matchAll(/"(?:transactionHash|txHash)"\s*:\s*"(0x[0-9a-fA-F]{64})"/g)) {
      const hash = match[1]!;
      const receipt = await ethers.provider.getTransactionReceipt(hash);
      if (receipt) found.add(hash);
    }
  }
  return [...found];
}

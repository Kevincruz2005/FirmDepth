import { network } from "hardhat";
import type {} from "@nomicfoundation/hardhat-ethers";
import { authenticateFirmDepthDeployment } from "../../sdk/dist/deployment.js";
import { readAquaCapacity } from "../../sdk/dist/readers.js";
import { createPublicClient, http } from "viem";
import { readPublicManifest, required, SEPOLIA_CHAIN_ID } from "./lib/public-demo.ts";

const { ethers } = await network.create();
if ((await ethers.provider.getNetwork()).chainId !== SEPOLIA_CHAIN_ID) throw new Error("Expected Sepolia chain");
const manifest = await readPublicManifest();
if (manifest.status !== "ready") throw new Error(`Sepolia manifest is ${manifest.status}`);
const client = createPublicClient({ transport: http(required("SEPOLIA_RPC_URL")) });
const authentication = await authenticateFirmDepthDeployment(client as never, manifest.addresses);
if (authentication.maxQuoteTtl !== 120n || authentication.blockNumber < BigInt(manifest.deployment.blockNumber)) throw new Error("Deployment block or TTL authentication failed");
const tokenAbi = ["function symbol() view returns (string)", "function decimals() view returns (uint8)"];
for (const [key, symbol, decimals] of [["weth", "WETH", 18], ["usdc", "USDC", 6]] as const) {
  const token = new ethers.Contract(manifest.addresses[key], tokenAbi, ethers.provider);
  if (await token.symbol() !== symbol || Number(await token.decimals()) !== decimals) throw new Error(`${key} metadata mismatch`);
}
const router = new ethers.Contract(manifest.addresses.firmRouter, ["function hash((address maker,uint256 traits,bytes data) order) view returns (bytes32)"], ethers.provider);
for (const strategy of manifest.strategies) {
  const order = { ...strategy.order, traits: BigInt(strategy.order.traits) };
  if ((await router.hash(order)).toLowerCase() !== strategy.orderHash.toLowerCase()) throw new Error(`${strategy.id} order hash mismatch`);
  const capacity = await readAquaCapacity(client as never, { aqua: manifest.addresses.aqua, router: manifest.addresses.firmRouter, maker: manifest.maker, orderHash: strategy.orderHash, tokenIn: manifest.addresses.weth, tokenOut: manifest.addresses.usdc });
  if (!capacity.strategyActive) throw new Error(`${strategy.id} is not active in Aqua`);
}
console.log(JSON.stringify({ status: "verified", chainId: Number(SEPOLIA_CHAIN_ID), blockNumber: authentication.blockNumber.toString(), manifestRevision: manifest.manifestRevision, maker: manifest.maker }, null, 2));

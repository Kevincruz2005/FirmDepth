import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ethers } from "ethers";

export const SEPOLIA_CHAIN_ID = 11155111n;
export const FIRM_PROGRAM = "0x52002100";
export const manifestPath = resolve(process.cwd(), "../../deployments/sepolia.json");

export async function readPublicManifest(): Promise<any> {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

export async function writePublicManifest(manifest: any): Promise<void> {
  const canonical = { ...manifest, manifestRevision: ethers.ZeroHash };
  manifest.manifestRevision = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(canonical)));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function requiredAddress(name: string): string {
  const address = ethers.getAddress(required(name));
  if (address === ethers.ZeroAddress) throw new Error(`${name} cannot be the zero address`);
  return address;
}

export function requiredKey(name: string): string {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte hex private key`);
  return value;
}

export function sourceRevision(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: resolve(process.cwd(), "../.."), encoding: "utf8" }).trim();
}

export function serializeOrder(order: { maker: string; traits: bigint; data: string }) {
  return { maker: ethers.getAddress(order.maker), traits: order.traits.toString(), data: order.data };
}

export function encodeOrder(order: { maker: string; traits: bigint; data: string }): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(["tuple(address maker,uint256 traits,bytes data)"], [order]);
}

export async function waitForSuccess(transaction: { hash: string; wait(): Promise<any> }): Promise<string> {
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`Transaction ${transaction.hash} did not succeed`);
  return transaction.hash;
}

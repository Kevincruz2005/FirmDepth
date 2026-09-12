import { readFile } from "node:fs/promises";
import { getAddress, isAddress, isHash, isHex } from "viem";
import type { ManifestStrategy, SepoliaManifest } from "./types.js";

export async function loadManifest(path: string): Promise<SepoliaManifest> {
  return parseManifest(JSON.parse(await readFile(path, "utf8")));
}

export function parseManifest(value: unknown): SepoliaManifest {
  const input = record(value, "manifest");
  if (input.schemaVersion !== "1") throw new Error("Unsupported Sepolia manifest schema");
  if (input.status !== "ready") throw new Error(`Sepolia manifest is ${String(input.status)}; run deployment and setup first`);
  if (typeof input.manifestRevision !== "string" || !isHash(input.manifestRevision)) throw new Error("Invalid manifest revision");
  const chain = record(input.chain, "chain");
  if (chain.id !== 11155111 || typeof chain.name !== "string" || typeof chain.explorerUrl !== "string") throw new Error("Invalid Sepolia chain metadata");
  const deployment = record(input.deployment, "deployment");
  if (!Number.isSafeInteger(deployment.blockNumber) || Number(deployment.blockNumber) <= 0 || typeof deployment.deployedAt !== "string") throw new Error("Invalid deployment metadata");
  const addresses = record(input.addresses, "addresses");
  for (const key of ["aqua", "weth", "usdc", "bondVault", "registry", "firmRouter", "executor"]) {
    if (typeof addresses[key] !== "string" || !isAddress(addresses[key])) throw new Error(`Invalid manifest address: ${key}`);
    addresses[key] = getAddress(addresses[key] as string);
  }
  if (typeof input.maker !== "string" || !isAddress(input.maker)) throw new Error("Invalid manifest maker");
  input.maker = getAddress(input.maker as string);
  const policies = record(input.policies, "policies");
  if (policies.pricingVersion !== 2 || policies.maxQuoteTtl !== 120 || policies.requiredBondBps !== 12000) throw new Error("Invalid public pricing policy");
  if (!Array.isArray(policies.horizons) || policies.horizons.join(",") !== "5,30,120") throw new Error("Invalid public quote horizons");
  for (const key of ["minimumAmountIn", "maximumAmountIn", "sigmaWad", "annualCapitalRateWad", "minPremiumOut"]) bigintString(policies[key], key);
  if (!Number.isInteger(policies.capacityKBps) || Number(policies.capacityKBps) < 0) throw new Error("Invalid capacityKBps");
  const opcode = record(input.opcodeConfiguration, "opcodeConfiguration");
  if (opcode.firmPrice !== 82 || opcode.firmGuard !== 33 || opcode.program !== "0x52002100") throw new Error("Invalid Firm opcode configuration");
  if (!Array.isArray(input.strategies) || input.strategies.length !== 2) throw new Error("Manifest must contain exactly the Soft and Firm strategies");
  for (const strategy of input.strategies) parseStrategy(strategy, input.maker as string);
  const kinds = input.strategies.map((item) => (item as ManifestStrategy).kind).sort().join(",");
  if (kinds !== "FIRM,SOFT") throw new Error("Manifest must contain one Soft and one Firm strategy");
  record(input.tokens, "tokens");
  record(input.sourceRevisions, "sourceRevisions");
  record(input.transactions, "transactions");
  return input as unknown as SepoliaManifest;
}

function parseStrategy(value: unknown, maker: string): void {
  const input = record(value, "strategy");
  if (typeof input.id !== "string" || typeof input.label !== "string" || !["SOFT", "FIRM"].includes(String(input.kind))) throw new Error("Invalid strategy metadata");
  if (typeof input.orderHash !== "string" || !isHash(input.orderHash) || typeof input.takerTraits !== "string" || !isHex(input.takerTraits) || typeof input.suggestedAmountIn !== "string") throw new Error("Invalid strategy encoding");
  const order = record(input.order, "strategy order");
  if (typeof order.maker !== "string" || !isAddress(order.maker) || getAddress(order.maker) !== getAddress(maker) || typeof order.traits !== "string" || typeof order.data !== "string" || !isHex(order.data)) throw new Error("Invalid strategy order");
  const balances = record(input.virtualBalances, "virtual balances");
  bigintString(balances.weth, "virtual WETH");
  bigintString(balances.usdc, "virtual USDC");
}

function bigintString(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`Invalid ${label}`);
  return BigInt(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

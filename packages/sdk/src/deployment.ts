import { getAddress, type Address, type PublicClient } from "viem";

import { bondVaultAbi, executorAbi, registryAbi, swapVmAbi } from "./requests.js";

export interface FirmDepthDeployment {
  aqua: Address;
  weth: Address;
  usdc: Address;
  bondVault: Address;
  registry: Address;
  firmRouter: Address;
  executor: Address;
}

export interface DeploymentAuthentication {
  blockNumber: bigint;
  maxQuoteTtl: bigint;
}

/** Authenticates contract identity by bytecode presence and frozen configuration relationships. */
export async function authenticateFirmDepthDeployment(
  client: PublicClient,
  addresses: FirmDepthDeployment,
): Promise<DeploymentAuthentication> {
  const entries = Object.entries(addresses) as [keyof FirmDepthDeployment, Address][];
  const code = await Promise.all(entries.map(([, address]) => client.getBytecode({ address })));
  for (let index = 0; index < entries.length; index += 1) {
    if (code[index] === undefined || code[index] === "0x") throw new Error(`${entries[index]![0]} has no deployed bytecode`);
  }

  const [
    registryVault, registryPremium, registryTokenIn, registryTokenOut, registryExecutor, maxQuoteTtl,
    vaultToken, vaultRegistry, executorRegistry, executorAqua, executorRouter,
    routerRegistry, routerVault, routerAqua, routerWeth, blockNumber,
  ] = await Promise.all([
    readAddress(client, addresses.registry, registryAbi, "vault"),
    readAddress(client, addresses.registry, registryAbi, "premiumToken"),
    readAddress(client, addresses.registry, registryAbi, "tokenIn"),
    readAddress(client, addresses.registry, registryAbi, "tokenOut"),
    readAddress(client, addresses.registry, registryAbi, "executor"),
    client.readContract({ address: addresses.registry, abi: registryAbi, functionName: "maxQuoteTtl" }),
    readAddress(client, addresses.bondVault, bondVaultAbi, "bondToken"),
    readAddress(client, addresses.bondVault, bondVaultAbi, "registry"),
    readAddress(client, addresses.executor, executorAbi, "registry"),
    readAddress(client, addresses.executor, executorAbi, "aqua"),
    readAddress(client, addresses.executor, executorAbi, "router"),
    readAddress(client, addresses.firmRouter, swapVmAbi, "FIRM_REGISTRY"),
    readAddress(client, addresses.firmRouter, swapVmAbi, "BOND_VAULT"),
    readAddress(client, addresses.firmRouter, swapVmAbi, "AQUA"),
    readAddress(client, addresses.firmRouter, swapVmAbi, "WETH"),
    client.getBlockNumber(),
  ]);

  const expected: [string, Address, Address][] = [
    ["registry.vault", registryVault, addresses.bondVault],
    ["registry.premiumToken", registryPremium, addresses.weth],
    ["registry.tokenIn", registryTokenIn, addresses.weth],
    ["registry.tokenOut", registryTokenOut, addresses.usdc],
    ["registry.executor", registryExecutor, addresses.executor],
    ["vault.bondToken", vaultToken, addresses.usdc],
    ["vault.registry", vaultRegistry, addresses.registry],
    ["executor.registry", executorRegistry, addresses.registry],
    ["executor.aqua", executorAqua, addresses.aqua],
    ["executor.router", executorRouter, addresses.firmRouter],
    ["router.FIRM_REGISTRY", routerRegistry, addresses.registry],
    ["router.BOND_VAULT", routerVault, addresses.bondVault],
    ["router.AQUA", routerAqua, addresses.aqua],
    ["router.WETH", routerWeth, addresses.weth],
  ];
  for (const [label, actual, wanted] of expected) {
    if (actual !== getAddress(wanted)) throw new Error(`${label} mismatch: expected ${wanted}, received ${actual}`);
  }
  return { blockNumber, maxQuoteTtl };
}

async function readAddress(
  client: PublicClient,
  address: Address,
  abi: typeof registryAbi | typeof bondVaultAbi | typeof executorAbi | typeof swapVmAbi,
  functionName: string,
): Promise<Address> {
  const value = await client.readContract({ address, abi, functionName } as never);
  return getAddress(String(value));
}

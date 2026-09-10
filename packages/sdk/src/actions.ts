import type {
  Account,
  Address,
  Hash,
  Hex,
  PublicClient,
  WalletClient,
} from "viem";

import {
  acceptRequest,
  depositBondRequest,
  executeRequest,
  expireRequest,
  withdrawBondRequest,
} from "./requests.js";
import type { FirmQuote, SwapVMOrder } from "./types.js";

export interface ContractClients {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account | Address;
}

export async function acceptFirm(
  clients: ContractClients,
  registry: Address,
  quote: FirmQuote,
  order: SwapVMOrder,
  makerSignature: Hex,
): Promise<{ hash: Hash; commitmentId: Hex }> {
  const { request, result } = await clients.publicClient.simulateContract({
    ...acceptRequest(registry, quote, order, makerSignature),
    account: clients.account,
  });
  const hash = await clients.walletClient.writeContract(request);
  return { hash, commitmentId: result };
}

export async function executeFirm(
  clients: ContractClients,
  executor: Address,
  commitmentId: Hex,
  order: SwapVMOrder,
): Promise<{ hash: Hash; terminalStatus: number; amountOut: bigint }> {
  const { request, result } = await clients.publicClient.simulateContract({
    ...executeRequest(executor, commitmentId, order),
    account: clients.account,
  });
  const hash = await clients.walletClient.writeContract(request);
  return { hash, terminalStatus: result[0], amountOut: result[1] };
}

export async function expireFirm(
  clients: ContractClients,
  registry: Address,
  commitmentId: Hex,
): Promise<Hash> {
  const { request } = await clients.publicClient.simulateContract({
    ...expireRequest(registry, commitmentId),
    account: clients.account,
  });
  return clients.walletClient.writeContract(request);
}

export async function depositBond(
  clients: ContractClients,
  vault: Address,
  amount: bigint,
): Promise<Hash> {
  const { request } = await clients.publicClient.simulateContract({
    ...depositBondRequest(vault, amount),
    account: clients.account,
  });
  return clients.walletClient.writeContract(request);
}

export async function withdrawBond(
  clients: ContractClients,
  vault: Address,
  amount: bigint,
  to: Address,
): Promise<Hash> {
  const { request } = await clients.publicClient.simulateContract({
    ...withdrawBondRequest(vault, amount, to),
    account: clients.account,
  });
  return clients.walletClient.writeContract(request);
}

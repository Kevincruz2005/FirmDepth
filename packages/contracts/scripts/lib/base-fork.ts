import type { Contract, JsonRpcProvider } from "ethers";
import { ethers } from "ethers";

export const BASE_FORK_BLOCK = 51_123_118;
export const BASE_AQUA = "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a";
export const BASE_SWAP_VM = "0x111111338c5091e8440b67b168bae16a668ac0de";
export const BASE_WETH = "0x4200000000000000000000000000000000000006";
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export interface AquaOrder {
  maker: string;
  traits: bigint;
  data: string;
}

export function buildAquaOrder(
  maker: string,
  tokenIn: string,
  tokenOut: string,
  program: string,
): AquaOrder {
  const normalizedMaker = ethers.getAddress(maker);
  const normalizedIn = ethers.getAddress(tokenIn);
  const normalizedOut = ethers.getAddress(tokenOut);
  if (normalizedIn === normalizedOut) throw new Error("Order tokens must differ");

  const [tokenA, tokenB] = BigInt(normalizedIn) < BigInt(normalizedOut)
    ? [normalizedIn, normalizedOut]
    : [normalizedOut, normalizedIn];
  const indexes = 0x0028002800280028n;
  const useAqua = 1n << 254n;

  return {
    maker: normalizedMaker,
    traits: useAqua | (indexes << 160n) | BigInt(normalizedMaker),
    data: ethers.concat([tokenA, tokenB, program]),
  };
}

export function encodeAquaStrategy(order: AquaOrder): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address maker,uint256 traits,bytes data)"],
    [order],
  );
}

export function buildSoftTakerTraits(tokenIn: string, tokenOut: string): string {
  const isAToB = BigInt(tokenIn) < BigInt(tokenOut);
  const flags = 0x0001 | 0x0020 | 0x0040 | (isAToB ? 0x0080 : 0);
  return ethers.concat([`0x${"0000".repeat(10)}`, ethers.toBeHex(flags, 2)]);
}

export async function findFundedTokenHolders(
  provider: JsonRpcProvider,
  token: Contract,
  minimumBalance: bigint,
  blockNumber: number,
): Promise<Array<{ address: string; balance: bigint }>> {
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const addresses = new Set<string>();
  for (let offset = 0; offset < 25 && addresses.size < 20; offset += 1) {
    const targetBlock = blockNumber - offset;
    const logs = await provider.getLogs({
      address: await token.getAddress(),
      fromBlock: targetBlock,
      toBlock: targetBlock,
      topics: [transferTopic],
    });
    for (const log of logs) {
      if (BigInt(log.data) < minimumBalance) continue;
      for (const topic of log.topics.slice(1, 3)) {
        const address = ethers.getAddress(`0x${topic.slice(-40)}`);
        if (address !== ethers.ZeroAddress) addresses.add(address);
      }
    }
  }

  const candidates = await Promise.all(
    [...addresses].map(async (address) => ({
      address,
      balance: BigInt(await token.balanceOf(address)),
    })),
  );
  return candidates
    .filter(({ balance }) => balance >= minimumBalance)
    .sort((left, right) => left.balance === right.balance ? 0 : left.balance > right.balance ? -1 : 1);
}

export async function fundFromImpersonatedHolder(
  provider: JsonRpcProvider,
  token: Contract,
  recipient: string,
  amount: bigint,
  blockNumber: number,
): Promise<{ holder: string; transactionHash: string }> {
  const candidates = await findFundedTokenHolders(provider, token, amount, blockNumber);
  for (const candidate of candidates) {
    await provider.send("hardhat_impersonateAccount", [candidate.address]);
    await provider.send("hardhat_setBalance", [candidate.address, ethers.toQuantity(ethers.parseEther("2"))]);
    try {
      const holder = await provider.getSigner(candidate.address);
      const transaction = await token.connect(holder).transfer(recipient, amount);
      await transaction.wait();
      return { holder: candidate.address, transactionHash: transaction.hash };
    } catch {
      // Some high-balance addresses are token contracts or denylisted. Try the next live holder.
    } finally {
      await provider.send("hardhat_stopImpersonatingAccount", [candidate.address]);
    }
  }
  throw new Error(`No recent token holder could transfer ${amount}`);
}

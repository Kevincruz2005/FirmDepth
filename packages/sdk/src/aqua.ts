import {
  Address as OneInchAddress,
  AquaProtocolContract,
  HexString,
} from "@1inch/aqua-sdk";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

const aquaPushAbi = parseAbi([
  "function push(address maker,address app,bytes32 strategyHash,address token,uint256 amount)",
]);

export interface AquaPositionAmount {
  token: Address;
  amount: bigint;
}

export function buildAquaShipRequest(
  aqua: Address,
  app: Address,
  encodedStrategy: Hex,
  positions: readonly AquaPositionAmount[],
) {
  if (positions.length === 0 || positions.length >= 255) {
    throw new RangeError("Aqua strategy must contain between 1 and 254 token positions");
  }
  const tx = AquaProtocolContract.buildShipTx(new OneInchAddress(aqua), {
    app: new OneInchAddress(app),
    strategy: new HexString(encodedStrategy),
    amountsAndTokens: positions.map(({ token, amount }) => ({
      token: new OneInchAddress(token),
      amount,
    })),
  });
  return { address: tx.to as Address, data: tx.data as Hex, value: tx.value } as const;
}

export function buildAquaDockRequest(
  aqua: Address,
  app: Address,
  strategyHash: Hex,
  tokens: readonly Address[],
) {
  if (tokens.length === 0 || tokens.length >= 255) {
    throw new RangeError("Aqua strategy must contain between 1 and 254 tokens");
  }
  const tx = AquaProtocolContract.buildDockTx(new OneInchAddress(aqua), {
    app: new OneInchAddress(app),
    strategyHash: new HexString(strategyHash),
    tokens: tokens.map((token) => new OneInchAddress(token)),
  });
  return { address: tx.to as Address, data: tx.data as Hex, value: tx.value } as const;
}

export function aquaStrategyHash(encodedStrategy: Hex): Hex {
  return AquaProtocolContract.calculateStrategyHash(new HexString(encodedStrategy)).toString();
}

/** Builds the real Aqua replenishment call for an existing active strategy. */
export function buildAquaPushRequest(
  aqua: Address,
  maker: Address,
  app: Address,
  strategyHash: Hex,
  token: Address,
  amount: bigint,
) {
  if (amount <= 0n) throw new RangeError("Aqua push amount must be greater than zero");
  return {
    address: aqua,
    data: encodeFunctionData({
      abi: aquaPushAbi,
      functionName: "push",
      args: [maker, app, strategyHash, token, amount],
    }),
    value: 0n,
  } as const;
}

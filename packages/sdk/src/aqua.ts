import {
  Address as OneInchAddress,
  AquaProtocolContract,
  HexString,
} from "@1inch/aqua-sdk";
import type { Address, Hex } from "viem";

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

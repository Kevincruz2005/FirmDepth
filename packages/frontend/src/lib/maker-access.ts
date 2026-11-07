import type { Address } from "viem";

export function makerAccessStatus({ maker, account, chainId, expectedChainId, walletReady }: {
  maker: Address | null; account: Address | null; chainId: number | null; expectedChainId: number | null; walletReady: boolean;
}): { allowed: boolean; message: string } {
  if (!maker || expectedChainId === null) return { allowed: false, message: "Maker controls are unavailable until the deployment is connected." };
  if (!account) return { allowed: false, message: "Read-only view. Connect a wallet to check whether it owns this maker's collateral." };
  if (chainId !== expectedChainId) return { allowed: false, message: "Your wallet is on a different network. Reconnect to this deployment before managing collateral." };
  if (account.toLowerCase() !== maker.toLowerCase()) return { allowed: false, message: "You are viewing another maker's collateral. Your connected wallet can use Trade and Settle; only the configured maker can deposit or withdraw its Bond." };
  if (!walletReady) return { allowed: false, message: "The maker address matches. Wallet network verification must finish before collateral controls are enabled." };
  return { allowed: true, message: "Maker wallet connected. You can deposit USDC or withdraw available Bond." };
}

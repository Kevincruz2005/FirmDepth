import { toHex } from "viem";
import type { LoadedRuntime } from "./runtime";

export class WalletNetworkError extends Error {}

export function walletNetworkDetails(runtime: LoadedRuntime) {
  const { artifact } = runtime;
  const isFork = artifact.environment.kind === "base-fork";
  return {
    name: isFork ? `FirmDepth ${artifact.environment.hosting === "azure" ? "Azure" : "Local"} Fork` : artifact.networkName,
    chainId: artifact.chainId,
    rpcUrl: artifact.rpcUrl,
    isFork,
  };
}

/** A chain ID alone cannot distinguish our fork from Base mainnet. */
export async function assertWalletNetwork(provider: EthereumProvider, runtime: LoadedRuntime): Promise<number> {
  const network = walletNetworkDetails(runtime);
  const chainId = Number(BigInt(String(await provider.request({ method: "eth_chainId" }))));
  if (chainId !== network.chainId) throw new WalletNetworkError(`Select ${network.name} (chain ${network.chainId}) in your wallet, then reconnect.`);
  if (network.isFork) {
    try {
      const address = runtime.artifact.addresses.firmRouter;
      const [code, block, walletCode] = await Promise.all([
        runtime.publicClient.getBytecode({ address }),
        runtime.publicClient.getBlock(),
        provider.request({ method: "eth_getCode", params: [address, "latest"] }),
      ]);
      const walletBlock = await provider.request({ method: "eth_getBlockByNumber", params: [toHex(block.number), false] }) as { hash?: string } | null;
      if (!code || code === "0x" || code !== walletCode || !block.hash || block.hash !== walletBlock?.hash) throw new Error("Fork mismatch");
    } catch {
      throw new WalletNetworkError("Your wallet RPC does not match this FirmDepth fork. Select the RPC URL shown below in your wallet's network settings, then reconnect. Base mainnet also uses chain 8453.");
    }
  }
  return chainId;
}

export async function switchToRuntimeNetwork(provider: EthereumProvider, runtime: LoadedRuntime): Promise<void> {
  const network = walletNetworkDetails(runtime);
  if (!network.isFork) {
    if (network.chainId !== 11155111) throw new WalletNetworkError(`Select ${network.name} in your wallet, then reconnect.`);
    await switchToSepolia(provider, network.rpcUrl, runtime.artifact.explorerUrl);
    return;
  }
  // Supply the fork RPC even if Base is already saved with this chain ID.
  // Wallets may still require the user to select that RPC manually.
  try {
    await provider.request({ method: "wallet_addEthereumChain", params: [{
      chainId: toHex(network.chainId), chainName: network.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: [network.rpcUrl],
    }] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(network.chainId) }] });
  } catch (cause) {
    const code = typeof cause === "object" && cause !== null && "code" in cause ? Number(cause.code) : undefined;
    if (code === 4001 || code === -32002) throw cause;
    throw new WalletNetworkError("Open your wallet's network settings, add or select the FirmDepth fork RPC shown below, then reconnect.");
  }
}

export async function switchToSepolia(provider: EthereumProvider, rpcUrl: string, explorerUrl?: string): Promise<void> {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
  } catch (cause) {
    const code = typeof cause === "object" && cause !== null && "code" in cause ? Number(cause.code) : undefined;
    if (code !== 4902) throw cause;
    await provider.request({ method: "wallet_addEthereumChain", params: [{
      chainId: "0xaa36a7", chainName: "Sepolia",
      nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: [rpcUrl], blockExplorerUrls: [explorerUrl ?? "https://sepolia.etherscan.io"],
    }] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
  }
}

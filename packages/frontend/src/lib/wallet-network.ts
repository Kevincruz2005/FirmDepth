import { toHex, type Address } from "viem";
import type { LoadedRuntime } from "./runtime";

export class WalletNetworkError extends Error {
  constructor(message: string, readonly kind: "mismatch" | "unavailable" = "mismatch") { super(message); }
}

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
export async function assertWalletNetwork(provider: EthereumProvider, runtime: LoadedRuntime, additionalAddresses: readonly Address[] = []): Promise<number> {
  const network = walletNetworkDetails(runtime);
  const chainId = Number(BigInt(String(await provider.request({ method: "eth_chainId" }))));
  if (chainId !== network.chainId) throw new WalletNetworkError(`Select ${network.name} (chain ${network.chainId}) in your wallet, then reconnect.`);
  if (network.isFork) {
    try {
      const block = await runtime.publicClient.getBlock();
      if (!block.hash || block.number === null) throw new Error("Reference block unavailable");
      // Use an immutable hash and explicit block tags. Wallets can retain
      // latest/code and block-number caches when RPCs share Base's chain ID.
      const addresses = [...new Set([runtime.artifact.addresses.firmRouter, ...additionalAddresses])];
      const [walletBlock, codes] = await Promise.all([
        provider.request({ method: "eth_getBlockByHash", params: [block.hash, false] }) as Promise<{ hash?: string; number?: string } | null>,
        Promise.all(addresses.map(async address => {
          const [code, walletCode] = await Promise.all([
            runtime.publicClient.getBytecode({ address, blockNumber: block.number! }),
            provider.request({ method: "eth_getCode", params: [address, toHex(block.number!)] }),
          ]);
          return typeof code === "string" && code !== "0x" && typeof walletCode === "string" && code.toLowerCase() === walletCode.toLowerCase();
        })),
      ]);
      if (walletBlock?.hash?.toLowerCase() !== block.hash.toLowerCase() || walletBlock?.number?.toLowerCase() !== toHex(block.number) || codes.some(valid => !valid)) {
        throw new WalletNetworkError("The wallet cannot see this fork's deployed contracts and reference block. Select the FirmDepth fork RPC in the wallet, save the network change, then reload this page and reconnect. Base mainnet uses the same chain ID, 8453.");
      }
    } catch (cause) {
      if (cause instanceof WalletNetworkError) throw cause;
      throw new WalletNetworkError("Fork verification could not complete because an RPC read failed. Retry the connection. This does not establish that your selected RPC is wrong.", "unavailable");
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

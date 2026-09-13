import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readTokenBalance } from "@firmdepth/sdk/readers";
import { createWalletClient, custom, getAddress, type Address, type WalletClient } from "viem";
import { loadRuntimeArtifact, type LoadedRuntime } from "../lib/runtime";
import { readErrorMessage } from "../lib/trade-errors";

interface RuntimeState {
  runtime: LoadedRuntime | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const RuntimeContext = createContext<RuntimeState | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<LoadedRuntime | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRuntime(await loadRuntimeArtifact());
    } catch (cause) {
      setRuntime(null);
      setError(readErrorMessage(cause, "Unable to load runtime"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const value = useMemo(() => ({ runtime, loading, error, refresh }), [runtime, loading, error, refresh]);
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): RuntimeState {
  const value = useContext(RuntimeContext);
  if (value === null) throw new Error("useRuntime must be used inside RuntimeProvider");
  return value;
}

export interface WalletState {
  account: Address | null;
  walletClient: WalletClient | null;
  chainId: number | null;
  ethBalance: bigint | null;
  wethBalance: bigint | null;
  connecting: boolean;
  error: string | null;
  epoch: number;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useWallet(): WalletState {
  const { runtime } = useRuntime();
  const [account, setAccount] = useState<Address | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [wethBalance, setWethBalance] = useState<bigint | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);

  const installAccount = useCallback((value: string | undefined) => {
    if (runtime === null || value === undefined || window.ethereum === undefined) {
      setAccount(null); setWalletClient(null); setEthBalance(null); setWethBalance(null); return;
    }
    const nextAccount = getAddress(value);
    setAccount(nextAccount);
    setWalletClient(createWalletClient({ account: nextAccount, chain: runtime.publicClient.chain, transport: custom(window.ethereum as any) }));
  }, [runtime]);

  const connect = useCallback(async () => {
    if (runtime === null) return setError("Load a matching runtime before connecting a wallet.");
    if (window.ethereum === undefined) return setError("No injected Ethereum wallet was found.");
    setConnecting(true);
    setError(null);
    try {
      let chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
      let walletChainId = Number(BigInt(String(chainIdHex)));
      if (walletChainId !== runtime.artifact.chainId && runtime.artifact.chainId === 11155111) {
        await switchToSepolia(window.ethereum, runtime.artifact.rpcUrl, runtime.artifact.explorerUrl);
        chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
        walletChainId = Number(BigInt(String(chainIdHex)));
      }
      setChainId(walletChainId);
      if (walletChainId !== runtime.artifact.chainId) throw new Error(`Wallet is on chain ${walletChainId}; expected ${runtime.artifact.chainId}`);
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      if (accounts[0] === undefined) throw new Error("Wallet returned no account");
      installAccount(accounts[0]);
      setDisconnected(false);
      setEpoch((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed");
    } finally {
      setConnecting(false);
    }
  }, [installAccount, runtime]);

  useEffect(() => {
    const provider = window.ethereum;
    if (provider?.on === undefined) return;
    const accountsChanged = (...args: unknown[]) => {
      if (disconnected) { setAccount(null); setWalletClient(null); setEpoch((value) => value + 1); return; }
      const accounts = Array.isArray(args[0]) ? args[0] as string[] : [];
      setError(null); installAccount(accounts[0]); setEpoch((value) => value + 1);
    };
    const chainChanged = (...args: unknown[]) => {
      const chainId = Number(BigInt(String(args[0])));
      setChainId(chainId);
      if (disconnected) { setAccount(null); setWalletClient(null); setEpoch((value) => value + 1); return; }
      if (runtime === null || chainId !== runtime.artifact.chainId) {
        setWalletClient(null);
        setError(runtime === null ? "Runtime is unavailable." : `Wallet is on chain ${chainId}; expected ${runtime.artifact.chainId}`);
      } else {
        setError(null);
        void provider.request({ method: "eth_accounts" }).then((values) => installAccount((values as string[])[0])).catch(() => installAccount(undefined));
      }
      setEpoch((value) => value + 1);
    };
    provider.on("accountsChanged", accountsChanged);
    provider.on("chainChanged", chainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
    };
  }, [disconnected, installAccount, runtime]);

  useEffect(() => {
    let current = true;
    setAccount(null); setWalletClient(null); setChainId(null); setEthBalance(null); setWethBalance(null); setError(null); setEpoch((value) => value + 1);
    if (runtime !== null && window.ethereum !== undefined && !disconnected) {
      void Promise.all([
        window.ethereum.request({ method: "eth_chainId" }),
        window.ethereum.request({ method: "eth_accounts" }),
      ]).then(([chain, values]) => {
        if (!current) return;
        const chainId = Number(BigInt(String(chain)));
        setChainId(chainId);
        if (chainId !== runtime.artifact.chainId) setError(`Wallet is on chain ${chainId}; expected ${runtime.artifact.chainId}`);
        else installAccount((values as string[])[0]);
      }).catch(() => undefined);
    }
    return () => { current = false; };
  }, [disconnected, installAccount, runtime]);

  useEffect(() => {
    if (runtime === null || account === null) { setEthBalance(null); setWethBalance(null); return; }
    let current = true;
    void Promise.all([
      runtime.publicClient.getBalance({ address: account }),
      readTokenBalance(runtime.publicClient, runtime.artifact.addresses.weth, account),
    ]).then(([eth, weth]) => { if (current) { setEthBalance(eth); setWethBalance(weth); } }).catch(() => { if (current) { setEthBalance(null); setWethBalance(null); } });
    return () => { current = false; };
  }, [account, epoch, runtime]);

  const disconnect = useCallback(() => {
    setDisconnected(true); setAccount(null); setWalletClient(null); setEthBalance(null); setWethBalance(null); setError(null); setEpoch((value) => value + 1);
  }, []);

  return { account, walletClient, chainId, ethBalance, wethBalance, connecting, error, epoch, connect, disconnect };
}

export async function switchToSepolia(provider: EthereumProvider, rpcUrl: string, explorerUrl?: string): Promise<void> {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
  } catch (cause) {
    const code = typeof cause === "object" && cause !== null && "code" in cause ? Number((cause as { code: unknown }).code) : undefined;
    if (code !== 4902) throw cause;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0xaa36a7",
        chainName: "Sepolia",
        nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [rpcUrl],
        blockExplorerUrls: [explorerUrl ?? "https://sepolia.etherscan.io"],
      }],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
  }
}

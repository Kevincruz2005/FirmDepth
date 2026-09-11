import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createWalletClient, custom, getAddress, type Address, type WalletClient } from "viem";
import { loadRuntimeArtifact, type LoadedRuntime } from "../lib/runtime";

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
      setError(cause instanceof Error ? cause.message : "Unable to load runtime");
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
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
}

export function useWallet(): WalletState {
  const { runtime } = useRuntime();
  const [account, setAccount] = useState<Address | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    if (runtime === null) return setError("Load a matching runtime before connecting a wallet.");
    if (window.ethereum === undefined) return setError("No injected Ethereum wallet was found.");
    setConnecting(true);
    setError(null);
    try {
      const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
      const walletChainId = Number(BigInt(String(chainIdHex)));
      if (walletChainId !== runtime.artifact.chainId) throw new Error(`Wallet is on chain ${walletChainId}; expected ${runtime.artifact.chainId}`);
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      if (accounts[0] === undefined) throw new Error("Wallet returned no account");
      const nextAccount = getAddress(accounts[0]);
      const nextClient = createWalletClient({
        account: nextAccount,
        chain: runtime.publicClient.chain,
        transport: custom(window.ethereum as any),
      });
      setAccount(nextAccount);
      setWalletClient(nextClient);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed");
    } finally {
      setConnecting(false);
    }
  }, [runtime]);

  return { account, walletClient, connecting, error, connect };
}

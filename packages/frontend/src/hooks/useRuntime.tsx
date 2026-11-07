import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { readTokenBalance } from "@firmdepth/sdk/readers";
import { createWalletClient, custom, getAddress, type Address, type WalletClient } from "viem";
import { loadRuntimeArtifact, type LoadedRuntime } from "../lib/runtime";
import { readErrorMessage } from "../lib/trade-errors";
import { mergeInjectedWallet, requestInjectedWallets, subscribeInjectedWallets, walletConnectionError, type InjectedWalletProvider, type InjectedWalletSummary } from "../lib/injected-wallets";
import { assertWalletNetwork, switchToRuntimeNetwork, WalletNetworkError } from "../lib/wallet-network";
export { switchToSepolia } from "../lib/wallet-network";

interface RuntimeState {
  runtime: LoadedRuntime | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const RuntimeContext = createContext<RuntimeState | null>(null);
const WalletContext = createContext<WalletState | null>(null);

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
  providers: InjectedWalletSummary[];
  discoverySettled: boolean;
  chooserOpen: boolean;
  selectedProviderId: string | null;
  openWalletChooser: () => void;
  closeWalletChooser: () => void;
  connectProvider: (providerId: string) => Promise<void>;
  disconnect: () => void;
}

export function WalletProvider({ children }: { children: ReactNode }) {
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
  const [providers, setProviders] = useState<InjectedWalletProvider[]>([]);
  const [discoverySettled, setDiscoverySettled] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const selectedProviderIdRef = useRef<string | null>(null);
  const accountCheckRef = useRef(0);
  const invalidateAccountChecks = useCallback(() => { accountCheckRef.current += 1; }, []);

  const selectProvider = useCallback((providerId: string | null) => {
    selectedProviderIdRef.current = providerId;
    setSelectedProviderId(providerId);
  }, []);

  const installAccount = useCallback(async (provider: EthereumProvider, value: string | undefined) => {
    const check = ++accountCheckRef.current;
    setWalletClient(null);
    if (runtime === null || value === undefined) {
      setAccount(null); setEthBalance(null); setWethBalance(null); return false;
    }
    try {
      const verifiedChainId = await assertWalletNetwork(provider, runtime);
      if (check !== accountCheckRef.current) return false;
      const nextAccount = getAddress(value);
      setChainId(verifiedChainId);
      setAccount(nextAccount);
      setError(null);
      setWalletClient(createWalletClient({ account: nextAccount, chain: runtime.publicClient.chain, transport: custom(provider as any) }));
      return true;
    } catch (cause) {
      if (check === accountCheckRef.current) {
        setAccount(null); setEthBalance(null); setWethBalance(null);
        setError(cause instanceof WalletNetworkError ? cause.message : walletConnectionError(cause));
      }
      return false;
    }
  }, [runtime]);

  useEffect(() => subscribeInjectedWallets(
    (provider) => setProviders((current) => mergeInjectedWallet(current, provider, selectedProviderIdRef.current)),
    () => setDiscoverySettled(true),
  ), []);

  const openWalletChooser = useCallback(() => {
    setError(null);
    setChooserOpen(true);
    requestInjectedWallets();
  }, []);
  const closeWalletChooser = useCallback(() => setChooserOpen(false), []);

  const connectProvider = useCallback(async (providerId: string) => {
    const selected = providers.find((provider) => provider.id === providerId);
    if (selected === undefined) return setError("That browser wallet is no longer available. Choose another wallet.");
    if (runtime === null) return setError("Live runtime unavailable. Retry after the runtime reconnects.");
    setConnecting(true);
    setError(null);
    try {
      try {
        await assertWalletNetwork(selected.provider, runtime);
      } catch (cause) {
        if (!(cause instanceof WalletNetworkError)) throw cause;
        await switchToRuntimeNetwork(selected.provider, runtime);
      }
      const walletChainId = await assertWalletNetwork(selected.provider, runtime);
      setChainId(walletChainId);
      const accounts = await selected.provider.request({ method: "eth_requestAccounts" }) as string[];
      if (accounts[0] === undefined) throw new Error("Wallet returned no account");
      if (!await installAccount(selected.provider, accounts[0])) return;
      setDisconnected(false);
      selectProvider(selected.id);
      setChooserOpen(false);
      setEpoch((value) => value + 1);
    } catch (cause) {
      const message = cause instanceof WalletNetworkError ? cause.message : walletConnectionError(cause);
      setError(message);
    } finally {
      setConnecting(false);
    }
  }, [installAccount, providers, runtime, selectProvider]);

  const selectedProvider = useMemo(() => providers.find((provider) => provider.id === selectedProviderId) ?? null, [providers, selectedProviderId]);

  useEffect(() => {
    const provider = selectedProvider?.provider;
    if (provider?.on === undefined) return;
    const accountsChanged = (...args: unknown[]) => {
      if (disconnected) { setAccount(null); setWalletClient(null); setEpoch((value) => value + 1); return; }
      const accounts = Array.isArray(args[0]) ? args[0] as string[] : [];
      setError(null); void installAccount(provider, accounts[0]); setEpoch((value) => value + 1);
    };
    const chainChanged = (...args: unknown[]) => {
      const chainId = Number(BigInt(String(args[0])));
      ++accountCheckRef.current;
      setChainId(chainId);
      setWalletClient(null);
      if (disconnected) { setAccount(null); setWalletClient(null); setEpoch((value) => value + 1); return; }
      if (runtime === null || chainId !== runtime.artifact.chainId) {
        setWalletClient(null);
        setError(runtime === null ? "Runtime is unavailable." : `Select ${runtime.artifact.networkName} (chain ${runtime.artifact.chainId}) in your wallet, then reconnect.`);
      } else {
        setError(null);
        void provider.request({ method: "eth_accounts" }).then((values) => installAccount(provider, (values as string[])[0])).catch(() => installAccount(provider, undefined));
      }
      setEpoch((value) => value + 1);
    };
    provider.on("accountsChanged", accountsChanged);
    provider.on("chainChanged", chainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
    };
  }, [disconnected, installAccount, invalidateAccountChecks, runtime, selectedProvider]);

  useEffect(() => {
    let current = true;
    setAccount(null); setWalletClient(null); setChainId(null); setEthBalance(null); setWethBalance(null); setError(null); setEpoch((value) => value + 1);
    if (runtime !== null && selectedProvider !== null && !disconnected) {
      void Promise.all([
        selectedProvider.provider.request({ method: "eth_chainId" }),
        selectedProvider.provider.request({ method: "eth_accounts" }),
      ]).then(([chain, values]) => {
        if (!current) return;
        const chainId = Number(BigInt(String(chain)));
        setChainId(chainId);
        if (chainId !== runtime.artifact.chainId) setError(`Select ${runtime.artifact.networkName} (chain ${runtime.artifact.chainId}) in your wallet, then reconnect.`);
        else installAccount(selectedProvider.provider, (values as string[])[0]);
      }).catch(() => undefined);
    }
    return () => { current = false; invalidateAccountChecks(); };
  }, [disconnected, installAccount, invalidateAccountChecks, runtime, selectedProvider]);

  useEffect(() => {
    if (runtime === null || disconnected || selectedProviderId !== null || providers.length !== 1) return;
    let current = true;
    const provider = providers[0]!;
    void Promise.all([
      provider.provider.request({ method: "eth_chainId" }),
      provider.provider.request({ method: "eth_accounts" }),
    ]).then(([chain, values]) => {
      if (!current || (values as string[])[0] === undefined) return;
      const nextChainId = Number(BigInt(String(chain)));
      if (nextChainId !== runtime.artifact.chainId) return;
      selectProvider(provider.id);
      setChainId(nextChainId);
      installAccount(provider.provider, (values as string[])[0]);
      setEpoch((value) => value + 1);
    }).catch(() => undefined);
    return () => { current = false; invalidateAccountChecks(); };
  }, [disconnected, installAccount, invalidateAccountChecks, providers, runtime, selectProvider, selectedProviderId]);

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
    ++accountCheckRef.current;
    setDisconnected(true); selectProvider(null); setChooserOpen(false); setAccount(null); setWalletClient(null); setChainId(null); setEthBalance(null); setWethBalance(null); setError(null); setEpoch((value) => value + 1);
  }, [selectProvider]);

  const providerSummaries = useMemo(() => providers.map(({ id, name, icon, rdns, legacy }) => ({ id, name, icon, rdns, legacy })), [providers]);
  const value = useMemo(() => ({ account, walletClient, chainId, ethBalance, wethBalance, connecting, error, epoch, providers: providerSummaries, discoverySettled, chooserOpen, selectedProviderId, openWalletChooser, closeWalletChooser, connectProvider, disconnect }), [account, walletClient, chainId, ethBalance, wethBalance, connecting, error, epoch, providerSummaries, discoverySettled, chooserOpen, selectedProviderId, openWalletChooser, closeWalletChooser, connectProvider, disconnect]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const value = useContext(WalletContext);
  if (value === null) throw new Error("useWallet must be used inside WalletProvider");
  return value;
}

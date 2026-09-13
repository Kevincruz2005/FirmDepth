export interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface InjectedWalletProvider {
  id: string;
  name: string;
  icon: string | null;
  rdns: string | null;
  legacy: boolean;
  provider: EthereumProvider;
}

export type InjectedWalletSummary = Omit<InjectedWalletProvider, "provider">;

export const LEGACY_PROVIDER_ID = "legacy-window-ethereum";

export function subscribeInjectedWallets(
  onProvider: (provider: InjectedWalletProvider) => void,
  onSettled: () => void,
  discoveryWindowMs = 200,
): () => void {
  let announced = false;
  const receive = (event: Event) => {
    const provider = providerFromAnnouncement((event as CustomEvent<unknown>).detail);
    if (provider === null) return;
    announced = true;
    onProvider(provider);
  };
  window.addEventListener("eip6963:announceProvider", receive);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const timer = window.setTimeout(() => {
    if (!announced && window.ethereum !== undefined) onProvider(legacyProvider(window.ethereum));
    onSettled();
  }, discoveryWindowMs);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("eip6963:announceProvider", receive);
  };
}

export function requestInjectedWallets(): void {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function mergeInjectedWallet(
  current: InjectedWalletProvider[],
  incoming: InjectedWalletProvider,
  selectedId: string | null,
): InjectedWalletProvider[] {
  if (incoming.legacy && current.some((wallet) => !wallet.legacy)) return current;
  const existing = current.find((wallet) => wallet.id === incoming.id);
  if (existing?.provider === incoming.provider && existing.name === incoming.name && existing.icon === incoming.icon && existing.rdns === incoming.rdns) return current;
  const withoutDuplicate = current.filter((wallet) => wallet.id !== incoming.id);
  const withoutFallback = incoming.legacy || selectedId === LEGACY_PROVIDER_ID
    ? withoutDuplicate
    : withoutDuplicate.filter((wallet) => !wallet.legacy);
  return [...withoutFallback, incoming].sort((a, b) => a.name.localeCompare(b.name));
}

export function safeWalletIcon(icon: string): string | null {
  return /^data:image\/(?:png|webp|gif|svg\+xml)(?:;base64)?,/i.test(icon) ? icon : null;
}

export function walletConnectionError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code = typeof cause === "object" && cause !== null && "code" in cause ? Number((cause as { code: unknown }).code) : undefined;
  if (code === 4001 || /rejected|denied|cancelled/i.test(message)) return "Wallet connection cancelled.";
  if (code === -32002 || /already pending|request.*pending/i.test(message)) return "A wallet connection request is already open.";
  return "Wallet connection failed. Retry from the selected wallet.";
}

function providerFromAnnouncement(value: unknown): InjectedWalletProvider | null {
  if (!isRecord(value) || !isRecord(value.info) || !isProvider(value.provider)) return null;
  const { uuid, name, icon, rdns } = value.info;
  if (![uuid, name, icon, rdns].every((field) => typeof field === "string") || uuid === "" || name === "") return null;
  return { id: uuid, name, icon: safeWalletIcon(icon), rdns, legacy: false, provider: value.provider };
}

function legacyProvider(provider: EthereumProvider): InjectedWalletProvider {
  const flags = provider as EthereumProvider & { isRabby?: boolean; isCoinbaseWallet?: boolean; isMetaMask?: boolean };
  const name = flags.isRabby ? "Rabby" : flags.isCoinbaseWallet ? "Coinbase Wallet" : flags.isMetaMask ? "MetaMask" : "Browser wallet";
  return { id: LEGACY_PROVIDER_ID, name, icon: null, rdns: null, legacy: true, provider };
}

function isProvider(value: unknown): value is EthereumProvider {
  return typeof value === "object" && value !== null && "request" in value && typeof (value as EthereumProvider).request === "function";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

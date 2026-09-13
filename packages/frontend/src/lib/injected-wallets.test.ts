import { afterEach, describe, expect, it, vi } from "vitest";
import { LEGACY_PROVIDER_ID, mergeInjectedWallet, safeWalletIcon, subscribeInjectedWallets, walletConnectionError, type InjectedWalletProvider } from "./injected-wallets";

afterEach(() => {
  vi.useRealTimers();
  delete window.ethereum;
});

describe("injected wallet discovery", () => {
  it("discovers an EIP-6963 MetaMask announcement", () => {
    vi.useFakeTimers();
    const provider = fakeProvider();
    const discovered: InjectedWalletProvider[] = [];
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: "metamask-id", name: "MetaMask", icon: "data:image/png;base64,AA==", rdns: "io.metamask" }, provider } }));
    window.addEventListener("eip6963:requestProvider", announce);
    const unsubscribe = subscribeInjectedWallets((wallet) => discovered.push(wallet), vi.fn(), 10);
    expect(discovered).toMatchObject([{ id: "metamask-id", name: "MetaMask", rdns: "io.metamask", legacy: false }]);
    unsubscribe();
    window.removeEventListener("eip6963:requestProvider", announce);
  });

  it("keeps multiple EIP-6963 providers and deduplicates repeated UUIDs", () => {
    const first = announcement("metamask-id", "MetaMask", "io.metamask");
    const second = announcement("rabby-id", "Rabby", "io.rabby");
    let wallets: InjectedWalletProvider[] = [];
    wallets = mergeInjectedWallet(wallets, first, null);
    wallets = mergeInjectedWallet(wallets, second, null);
    wallets = mergeInjectedWallet(wallets, second, null);
    expect(wallets.map(({ name }) => name)).toEqual(["MetaMask", "Rabby"]);
  });

  it("falls back to a legacy window.ethereum provider when EIP-6963 is absent", () => {
    vi.useFakeTimers();
    const provider = Object.assign(fakeProvider(), { isRabby: true });
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    const discovered: InjectedWalletProvider[] = [];
    const settled = vi.fn();
    const unsubscribe = subscribeInjectedWallets((wallet) => discovered.push(wallet), settled, 10);
    vi.advanceTimersByTime(10);
    expect(discovered).toMatchObject([{ id: LEGACY_PROVIDER_ID, name: "Rabby", legacy: true }]);
    expect(settled).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("accepts only data-image icons and normalizes rejected connections", () => {
    expect(safeWalletIcon("data:image/svg+xml,<svg />")).toBe("data:image/svg+xml,<svg />");
    expect(safeWalletIcon("https://example.com/icon.svg")).toBeNull();
    expect(walletConnectionError(Object.assign(new Error("User rejected request"), { code: 4001 }))).toBe("Wallet connection cancelled.");
  });
});

function announcement(id: string, name: string, rdns: string): InjectedWalletProvider {
  return { id, name, rdns, icon: null, legacy: false, provider: fakeProvider() };
}

function fakeProvider(): EthereumProvider {
  return { request: vi.fn(async () => null) };
}

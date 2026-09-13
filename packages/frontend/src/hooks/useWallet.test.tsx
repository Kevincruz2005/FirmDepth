import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sepolia } from "viem/chains";

const mocks = vi.hoisted(() => ({ loadRuntimeArtifact: vi.fn(), readTokenBalance: vi.fn(async () => 0n) }));
vi.mock("../lib/runtime", () => ({ loadRuntimeArtifact: mocks.loadRuntimeArtifact }));
vi.mock("@firmdepth/sdk/readers", () => ({ readTokenBalance: mocks.readTokenBalance }));

import { RuntimeProvider, useRuntime, useWallet, WalletProvider } from "./useRuntime";

const firstAccount = "0x1111111111111111111111111111111111111111";
const secondAccount = "0x2222222222222222222222222222222222222222";

describe("selected injected wallet lifecycle", () => {
  beforeEach(() => {
    mocks.loadRuntimeArtifact.mockResolvedValue({
      artifact: { chainId: 11155111, rpcUrl: "https://rpc.example", explorerUrl: "https://sepolia.etherscan.io", addresses: { weth: "0x3333333333333333333333333333333333333333" }, environment: { label: "Sepolia" } },
      publicClient: { chain: sepolia, getBalance: vi.fn(async () => 0n) },
    });
  });

  afterEach(() => { delete window.ethereum; });

  it("selects one EIP-6963 provider and follows its account and chain events", async () => {
    const metamask = fakeEventProvider();
    const rabby = fakeEventProvider();
    renderWallet();
    await screen.findByText("runtime-ready");
    announce("metamask-id", "MetaMask", "io.metamask", metamask.provider);
    announce("rabby-id", "Rabby", "io.rabby", rabby.provider);
    await screen.findByText("MetaMask,Rabby");

    fireEvent.click(screen.getByRole("button", { name: "Connect Rabby" }));
    await screen.findByText(firstAccount);
    expect(rabby.requestedMethods()).toContain("eth_requestAccounts");
    expect(metamask.requestedMethods()).not.toContain("eth_requestAccounts");

    act(() => rabby.emitAccounts(secondAccount));
    await screen.findByText(secondAccount);
    act(() => rabby.emitChain("0x1"));
    await screen.findByText("chain-1");
    act(() => rabby.emitChain("0xaa36a7"));
    await screen.findByText("chain-11155111");
    expect(screen.getByTestId("account")).toHaveTextContent(secondAccount);
  });

  it("reports a rejected provider request without exposing its raw error", async () => {
    const rejected = fakeEventProvider(true);
    renderWallet();
    await screen.findByText("runtime-ready");
    announce("metamask-id", "MetaMask", "io.metamask", rejected.provider);
    await screen.findByText("MetaMask");
    fireEvent.click(screen.getByRole("button", { name: "Connect MetaMask" }));
    await screen.findByText("Wallet connection cancelled.");
    expect(screen.queryByText(/Internal provider rejection detail/)).not.toBeInTheDocument();
  });
});

function renderWallet() {
  return render(<RuntimeProvider><WalletProvider><Harness /></WalletProvider></RuntimeProvider>);
}

function Harness() {
  const runtime = useRuntime();
  const wallet = useWallet();
  return <div>
    <span>{runtime.runtime ? "runtime-ready" : "runtime-loading"}</span>
    <span>{wallet.providers.map(({ name }) => name).join(",")}</span>
    <span data-testid="account">{wallet.account ?? "no-account"}</span>
    <span>chain-{wallet.chainId ?? "none"}</span>
    <span>{wallet.error}</span>
    {wallet.providers.map((provider) => <button key={provider.id} onClick={() => void wallet.connectProvider(provider.id)}>Connect {provider.name}</button>)}
  </div>;
}

function announce(id: string, name: string, rdns: string, provider: EthereumProvider) {
  act(() => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: id, name, rdns, icon: "data:image/png;base64,AA==" }, provider } })));
}

function fakeEventProvider(rejectConnection = false) {
  let account = firstAccount;
  let authorized = false;
  let chain = "0xaa36a7";
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_chainId") return chain;
    if (method === "eth_accounts") return authorized ? [account] : [];
    if (method === "eth_requestAccounts") {
      if (rejectConnection) throw Object.assign(new Error("Internal provider rejection detail"), { code: 4001 });
      authorized = true;
      return [account];
    }
    return null;
  });
  const provider: EthereumProvider = {
    request,
    on(event, listener) { const current = listeners.get(event) ?? new Set(); current.add(listener); listeners.set(event, current); },
    removeListener(event, listener) { listeners.get(event)?.delete(listener); },
  };
  return {
    provider,
    requestedMethods: () => request.mock.calls.map(([value]) => value.method),
    emitAccounts(value: string) { account = value; for (const listener of listeners.get("accountsChanged") ?? []) listener([value]); },
    emitChain(value: string) { chain = value; for (const listener of listeners.get("chainChanged") ?? []) listener(value); },
  };
}

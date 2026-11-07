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

  function useForkRuntime() {
    const runtime = mocks.loadRuntimeArtifact.getMockImplementation()!();
    return Promise.resolve(runtime).then((value) => {
      value.artifact = { ...value.artifact, chainId: 8453, networkName: "FirmDepth Azure Fork", environment: { kind: "base-fork", hosting: "azure" }, addresses: {...value.artifact.addresses, firmRouter:firstAccount} };
      value.publicClient = { ...value.publicClient, chain: {...sepolia,id:8453}, getBytecode: vi.fn(async()=>"0x6001"), getBlock:vi.fn(async()=>({number:100n,hash:`0x${"ab".repeat(32)}`})) };
      mocks.loadRuntimeArtifact.mockResolvedValue(value);
    });
  }

  it("connects a Sepolia wallet to the verified fork through network setup", async () => {
    await useForkRuntime();
    const metamask = fakeEventProvider();
    renderWallet();
    await screen.findByText("runtime-ready");
    announce("metamask-id", "MetaMask", "io.metamask", metamask.provider);
    fireEvent.click(await screen.findByRole("button", {name:"Connect MetaMask"}));
    await screen.findByText("signer-ready");
    expect(metamask.requestedMethods()).toContain("wallet_addEthereumChain");
    expect(metamask.requestedMethods()).toContain("wallet_switchEthereumChain");
    expect(screen.getByTestId("account")).toHaveTextContent(firstAccount);
  });

  it("blocks a wallet on public Base even after a successful chain switch", async () => {
    await useForkRuntime();
    const metamask = fakeEventProvider();
    metamask.setCode("0x");
    renderWallet();
    await screen.findByText("runtime-ready");
    announce("metamask-id", "MetaMask", "io.metamask", metamask.provider);
    fireEvent.click(await screen.findByRole("button", {name:"Connect MetaMask"}));
    await screen.findByText(/cannot see this fork/);
    expect(screen.getByTestId("signer")).toHaveTextContent("no-signer");
    expect(metamask.requestedMethods()).not.toContain("eth_requestAccounts");
  });

  it("rechecks fork identity after chain and account events", async () => {
    await useForkRuntime();
    const metamask = fakeEventProvider();
    renderWallet();
    await screen.findByText("runtime-ready");
    announce("metamask-id", "MetaMask", "io.metamask", metamask.provider);
    fireEvent.click(await screen.findByRole("button", {name:"Connect MetaMask"}));
    await screen.findByText("signer-ready");
    metamask.setCode("0x");
    act(() => metamask.emitChain("0x2105"));
    await screen.findByText(/cannot see this fork/);
    expect(screen.getByTestId("signer")).toHaveTextContent("no-signer");
    act(() => metamask.emitAccounts(secondAccount));
    await screen.findByText(/cannot see this fork/);
    expect(screen.getByTestId("signer")).toHaveTextContent("no-signer");
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
    <span data-testid="signer">{wallet.walletClient ? "signer-ready" : "no-signer"}</span>
    <button onClick={wallet.disconnect}>Disconnect</button>
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
  let code = "0x6001";
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] | object }) => {
    if (method === "eth_chainId") return chain;
    if (method === "wallet_switchEthereumChain") { chain = (params as Array<{chainId:string}>)[0]!.chainId; return null; }
    if (method === "eth_getCode") return code;
    if (method === "eth_getBlockByHash") return {hash:`0x${"ab".repeat(32)}`,number:"0x64"};
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
    setCode(value: string) { code = value; },
    requestedMethods: () => request.mock.calls.map(([value]) => value.method),
    emitAccounts(value: string) { account = value; for (const listener of listeners.get("accountsChanged") ?? []) listener([value]); },
    emitChain(value: string) { chain = value; for (const listener of listeners.get("chainChanged") ?? []) listener(value); },
  };
}

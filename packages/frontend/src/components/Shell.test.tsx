import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./Shell";

const state = vi.hoisted(() => ({
  runtime: { runtime: { artifact: { chainId: 11155111, networkName: "Sepolia", environment: { label: "Sepolia" } } }, loading: false, error: null },
  wallet: { account: null as string | null, chainId: null as number | null, connecting: false, error: null as string | null, providers: [] as Array<{ id: string; name: string; icon: string | null; rdns: string | null; legacy: boolean }>, discoverySettled: true, chooserOpen: false, selectedProviderId: null as string | null, openWalletChooser: vi.fn(), closeWalletChooser: vi.fn(), connectProvider: vi.fn(), disconnect: vi.fn() },
}));

vi.mock("../hooks/useRuntime", () => ({ useRuntime: () => state.runtime, useWallet: () => state.wallet }));

describe("global wallet header", () => {
  beforeEach(() => {
    Object.assign(state.runtime.runtime.artifact, { chainId: 11155111, networkName: "Sepolia", environment: { label: "Sepolia" } });
    state.wallet.account = null; state.wallet.chainId = null; state.wallet.error = null; state.wallet.providers = []; state.wallet.discoverySettled = true; state.wallet.chooserOpen = false; state.wallet.selectedProviderId = null;
    state.wallet.openWalletChooser.mockReset(); state.wallet.closeWalletChooser.mockReset(); state.wallet.connectProvider.mockReset(); state.wallet.disconnect.mockReset();
  });

  it("shows the global connection action and no redundant Open app link", () => {
    render(<Shell route="/trade"><p>Trade</p></Shell>);
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(state.wallet.openWalletChooser).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link", { name: /Open app/i })).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
  });

  it("shows the connected account and network with disconnect in its menu", () => {
    state.wallet.account = "0x885a51365c30De518a1efAd46a28531B9ad9B509";
    state.wallet.chainId = 11155111;
    render(<Shell route="/trade"><p>Trade</p></Shell>);
    const account = screen.getByRole("button", { name: /Sepolia.*0x885a…B509/i });
    fireEvent.click(account);
    expect(screen.getByText(state.wallet.account)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(state.wallet.disconnect).toHaveBeenCalledOnce();
  });

  it("shows every detected wallet and connects only the selected provider", () => {
    state.wallet.chooserOpen = true;
    state.wallet.providers = [
      { id: "metamask-id", name: "MetaMask", icon: null, rdns: "io.metamask", legacy: false },
      { id: "rabby-id", name: "Rabby", icon: null, rdns: "io.rabby", legacy: false },
    ];
    render(<Shell route="/trade"><p>Trade</p></Shell>);
    expect(screen.getByRole("dialog", { name: "Choose wallet" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Rabby/ }));
    expect(state.wallet.connectProvider).toHaveBeenCalledWith("rabby-id");
    expect(state.wallet.connectProvider).not.toHaveBeenCalledWith("metamask-id");
  });

  it("shows safe install guidance and concise cancellation feedback when no wallet exists", () => {
    state.wallet.chooserOpen = true;
    state.wallet.error = "Wallet connection cancelled.";
    render(<Shell route="/trade"><p>Trade</p></Shell>);
    expect(screen.getByText("No browser wallet detected.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Wallet connection cancelled.");
    expect(screen.getByRole("link", { name: /Install MetaMask/ })).toHaveAttribute("href", "https://metamask.io/download/");
    expect(screen.getByRole("link", { name: /Install Rabby/ })).toHaveAttribute("href", "https://rabby.io/");
  });

  it("explains the fork network and exposes its exact manual RPC settings", () => {
    Object.assign(state.runtime.runtime.artifact, { chainId: 8453, rpcUrl: "https://fork.example/rpc", environment: { kind: "base-fork", hosting: "azure", label: "Azure Base Fork" } });
    state.wallet.chooserOpen = true;
    state.wallet.error = "Select the fork RPC.";
    render(<Shell route="/settlement"><p>Settle</p></Shell>);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText("FirmDepth Azure Fork")).toHaveLength(2);
    expect(within(dialog).getByText(/Base mainnet uses the same chain ID/)).toBeVisible();
    expect(within(dialog).getByText("https://fork.example/rpc")).toBeVisible();
    expect(dialog.querySelector("details")).toHaveAttribute("open");
  });
});

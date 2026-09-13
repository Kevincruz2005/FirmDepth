import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./Shell";

const state = vi.hoisted(() => ({
  runtime: { runtime: { artifact: { chainId: 11155111, networkName: "Sepolia", environment: { label: "Sepolia" } } }, loading: false, error: null },
  wallet: { account: null as string | null, chainId: null as number | null, connecting: false, connect: vi.fn(), disconnect: vi.fn() },
}));

vi.mock("../hooks/useRuntime", () => ({ useRuntime: () => state.runtime, useWallet: () => state.wallet }));

describe("global wallet header", () => {
  beforeEach(() => { state.wallet.account = null; state.wallet.chainId = null; state.wallet.connect.mockReset(); state.wallet.disconnect.mockReset(); });

  it("shows the global connection action and no redundant Open app link", () => {
    render(<Shell route="/trade"><p>Trade</p></Shell>);
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(state.wallet.connect).toHaveBeenCalledOnce();
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
});

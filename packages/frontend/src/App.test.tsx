import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
});

describe("FirmDepth application", () => {
  it("renders the product-led landing narrative with explicit provenance", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: /the quote is soft/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /one market. three depths/i })).toBeInTheDocument();
    expect(screen.getAllByText("VERIFIED BASE-FORK RUN").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SYNTHETIC BENCHMARK").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument());
  });

  it("navigates client-side to all product surfaces", async () => {
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open app/i })).not.toBeInTheDocument();
    fireEvent.click(within(navigation).getByRole("link", { name: "Trade" }));
    expect(await screen.findByRole("heading", { name: /trade the depth you can prove/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Connect wallet" })).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "Trade details" })).queryByRole("button", { name: "Connect wallet" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "120s" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/120s is recommended for Sepolia manual demos/i)).toBeInTheDocument();
    fireEvent.click(within(navigation).getByRole("link", { name: "Evidence" }));
    expect(await screen.findByRole("heading", { name: /trust the status badge/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /real wallet reached FILLED_AQUA/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /deterministic sponsor-compliance proof/i })).toBeInTheDocument();
    expect(screen.getByText("11694311")).toBeInTheDocument();
    expect(screen.getAllByText("0x52002100").length).toBeGreaterThan(0);
    fireEvent.click(within(navigation).getByRole("link", { name: "Maker" }));
    expect(await screen.findByRole("heading", { name: /make certainty a priced resource/i })).toBeInTheDocument();
    fireEvent.click(within(navigation).getByRole("link", { name: "Docs" }));
    expect(await screen.findByRole("heading", { name: /execution certainty, explained/i })).toBeInTheDocument();
    for (const heading of ["Overview", "Three Depths", "Commitment lifecycle", "SwapVM extension", "Security properties", "Current scope / limitations"]) expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/PRIVATE_KEY|SECRET_RPC|MNEMONIC/i);
  });

  it("keeps the landing CTA pointed at Trade", async () => {
    render(<App />);
    expect(await screen.findByRole("link", { name: "Inspect live depth" })).toHaveAttribute("href", "/trade");
  });
});

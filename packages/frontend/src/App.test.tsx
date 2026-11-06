import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
});

describe("FirmDepth application", () => {
  it("keeps debt repayment unavailable when no authenticated adapter is configured",async()=>{
    window.history.pushState({},"","/settlement");render(<App/>);
    fireEvent.click(await screen.findByRole("button",{name:"Debt Repayment"}));
    expect(await screen.findByText(/This deployment has no authenticated repayment adapter/)).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Create repayment plan"})).not.toBeInTheDocument();
  });
  it("renders the product-led landing narrative with explicit provenance", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: /the quote is soft/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /one market. three depths/i })).toBeInTheDocument();
    expect(screen.getAllByText("VERIFIED BASE-FORK RUN").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SYNTHETIC BENCHMARK").length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent("0.2000 WETH");
    expect(document.body).not.toHaveTextContent("690.00 USDC");
    expect(document.body).not.toHaveTextContent("0.000173 WETH");
    expect(screen.queryByRole("link", { name: /Verify the Base-fork run/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Trade on Sepolia" })).toHaveAttribute("href", "/trade");
    expect(screen.getByRole("link", { name: "View evidence" })).toHaveAttribute("href", "/evidence");
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
    const manualProof = screen.getByRole("heading", { name: /real wallet reached FILLED_AQUA/i });
    const liveRuntime = screen.getByRole("heading", { name: /current contract state/i });
    const sponsorProof = screen.getByRole("heading", { name: /pinned proof, available on demand/i });
    expect(manualProof.compareDocumentPosition(liveRuntime) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(liveRuntime.compareDocumentPosition(sponsorProof) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText("REAL SEPOLIA · VERIFIED")[0]).toHaveClass("source-badge");
    const disclosureLabel = screen.getByText("View canonical Base-fork proof");
    const disclosure = disclosureLabel.closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(disclosureLabel);
    expect(disclosure).toHaveAttribute("open");
    expect(within(disclosure!).getByText("Base · block 51,123,118")).toBeInTheDocument();
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
    expect(await screen.findByRole("link", { name: "Trade on Sepolia" })).toHaveAttribute("href", "/trade");
  });
});

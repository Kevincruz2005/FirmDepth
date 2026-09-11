import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
});

describe("FirmDepth application", () => {
  it("renders the product-led landing narrative with explicit provenance", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /the quote is soft/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /one market. three depths/i })).toBeInTheDocument();
    expect(screen.getAllByText("VERIFIED BASE-FORK RUN").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SYNTHETIC BENCHMARK").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText("Evidence mode")).toBeInTheDocument());
  });

  it("navigates client-side to all product surfaces", async () => {
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    fireEvent.click(within(navigation).getByRole("link", { name: "Trade" }));
    expect(await screen.findByRole("heading", { name: /trade the depth you can prove/i })).toBeInTheDocument();
    fireEvent.click(within(navigation).getByRole("link", { name: "Evidence" }));
    expect(await screen.findByRole("heading", { name: /trust the status badge/i })).toBeInTheDocument();
    fireEvent.click(within(navigation).getByRole("link", { name: "Maker" }));
    expect(await screen.findByRole("heading", { name: /make certainty a priced resource/i })).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from "vitest";
import { switchToSepolia } from "./useRuntime";

describe("Sepolia wallet switching", () => {
  it("requests the canonical Sepolia chain", async () => {
    const request = vi.fn(async () => null);
    await switchToSepolia({ request }, "https://rpc.example", "https://sepolia.etherscan.io");
    expect(request).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
  });

  it("adds Sepolia only after a 4902 unknown-chain response", async () => {
    let attempts = 0;
    const request = vi.fn(async ({ method }: { method: string; params?: unknown[] | object }) => {
      if (method === "wallet_switchEthereumChain" && attempts++ === 0) throw Object.assign(new Error("unknown"), { code: 4902 });
      return null;
    });
    await switchToSepolia({ request }, "https://rpc.example", "https://sepolia.etherscan.io");
    expect(request.mock.calls.map(([value]) => value.method)).toEqual(["wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain"]);
    const addParams = request.mock.calls[1]![0].params as Array<{ chainId: string }>;
    expect(addParams[0]!.chainId).toBe("0xaa36a7");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { LoadedRuntime } from "./runtime";
import { assertWalletNetwork, switchToRuntimeNetwork } from "./wallet-network";

const blockHash = `0x${"ab".repeat(32)}`;
function forkRuntime() {
  return {
    artifact: { chainId: 8453, rpcUrl: "https://fork.example/rpc", environment: { kind: "base-fork", hosting: "azure" }, addresses: { firmRouter: "0x1111111111111111111111111111111111111111" } },
    publicClient: { getBytecode: vi.fn(async () => "0x6001"), getBlock: vi.fn(async () => ({ number: 100n, hash: blockHash })) },
  } as unknown as LoadedRuntime;
}
function forkProvider(code: string = "0x6001", hash: string | null = blockHash) {
  return { request: vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getCode") return code;
    if (method === "eth_getBlockByNumber") return hash ? { hash } : null;
    return null;
  }) };
}

describe("fork wallet network", () => {
  it("adds the exact fork RPC before switching, without a mainnet explorer", async () => {
    const provider = forkProvider();
    await switchToRuntimeNetwork(provider, forkRuntime());
    expect(provider.request.mock.calls).toEqual([
      [{ method: "wallet_addEthereumChain", params: [{ chainId: "0x2105", chainName: "FirmDepth Azure Fork", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://fork.example/rpc"] }] }],
      [{ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }],
    ]);
  });

  it("accepts matching chain ID, deployed code and block hash", async () => {
    expect(await assertWalletNetwork(forkProvider(), forkRuntime())).toBe(8453);
  });

  it.each([
    ["0x", blockHash],
    ["0x6002", blockHash],
    ["0x6001", `0x${"cd".repeat(32)}`],
    ["0x6001", null],
  ])("rejects another RPC despite chain 8453 (code %s, hash %s)", async (code, hash) => {
    await expect(assertWalletNetwork(forkProvider(code!, hash), forkRuntime())).rejects.toThrow("RPC does not match");
  });

  it("rejects missing runtime code even if both RPCs return empty code", async () => {
    const runtime = forkRuntime();
    vi.mocked(runtime.publicClient.getBytecode).mockResolvedValue("0x");
    await expect(assertWalletNetwork(forkProvider("0x"), runtime)).rejects.toThrow("RPC does not match");
  });

  it("preserves wallet cancellation and pending-request errors", async () => {
    for (const code of [4001, -32002]) {
      const error = Object.assign(new Error("Wallet rejected setup"), { code });
      const provider = { request: vi.fn(async () => { throw error; }) };
      await expect(switchToRuntimeNetwork(provider, forkRuntime())).rejects.toBe(error);
      expect(provider.request).toHaveBeenCalledOnce();
    }
  });

  it("offers manual RPC setup when a wallet refuses to update an existing chain", async () => {
    const provider = { request: vi.fn(async () => { throw Object.assign(new Error("Existing chain"), { code: -32602 }); }) };
    await expect(switchToRuntimeNetwork(provider, forkRuntime())).rejects.toThrow("network settings");
    expect(provider.request).toHaveBeenCalledOnce();
  });
});

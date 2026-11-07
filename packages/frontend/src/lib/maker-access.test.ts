import { describe, expect, it } from "vitest";
import { makerAccessStatus } from "./maker-access";

const maker = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const payer = "0x885a51365c30De518a1efAd46a28531B9ad9B509" as const;
const connected = {maker,account:maker,chainId:8453,expectedChainId:8453,walletReady:true};
describe("configured maker access", () => {
  it("allows the verified maker regardless of address letter case", () => {
    expect(makerAccessStatus({...connected,account:maker.toLowerCase() as typeof maker}).allowed).toBe(true);
  });
  it("keeps a connected payer read-only and explains its available flows", () => {
    expect(makerAccessStatus({...connected,account:payer})).toMatchObject({allowed:false,message:expect.stringContaining("Trade and Settle")});
  });
  it("blocks the correct maker on a different chain", () => {
    expect(makerAccessStatus({...connected,chainId:11155111}).allowed).toBe(false);
  });
  it("blocks writes while the wallet's fork identity remains unverified", () => {
    expect(makerAccessStatus({...connected,walletReady:false})).toMatchObject({allowed:false,message:expect.stringContaining("address matches")});
  });
  it("does not infer maker authority from a missing account or deployment", () => {
    expect(makerAccessStatus({...connected,account:null}).allowed).toBe(false);
    expect(makerAccessStatus({...connected,maker:null}).allowed).toBe(false);
    expect(makerAccessStatus({...connected,expectedChainId:null}).allowed).toBe(false);
  });
});

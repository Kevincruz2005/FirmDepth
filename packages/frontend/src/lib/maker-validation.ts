import { parseUnits } from "viem";

export interface MakerAmountValidation {
  value: bigint | null;
  error: string | null;
}

export function validateMakerAmount(raw: string, available: bigint | null, kind: "deposit" | "withdraw"): MakerAmountValidation {
  if (raw.trim() === "") return { value: null, error: "Enter a USDC amount." };
  if (!/^(?:\d+)(?:\.\d{0,6})?$/.test(raw)) return { value: null, error: "Use a valid USDC amount with at most 6 decimals." };
  try {
    const value = parseUnits(raw, 6);
    if (value <= 0n) return { value: null, error: "Amount must be greater than zero." };
    if (available === null) return { value: null, error: kind === "deposit" ? "Maker wallet balance unavailable." : "Available Bond unavailable." };
    if (value > available) return { value: null, error: kind === "deposit" ? "Insufficient USDC balance" : "Withdrawal exceeds available Bond" };
    return { value, error: null };
  } catch {
    return { value: null, error: "USDC amount is malformed or too large." };
  }
}

export function makerErrorMessage(cause: unknown): { summary: string; technical: string | null } {
  const technical = cause instanceof Error ? cause.message : String(cause);
  if (/transfer amount exceeds balance|insufficient.*balance/i.test(technical)) return { summary: "Insufficient USDC balance", technical };
  if (/allowance|approve/i.test(technical)) return { summary: "USDC approval is required. Retry the deposit and confirm the approval.", technical };
  if (/rejected|denied|4001/i.test(technical)) return { summary: "Wallet request rejected.", technical };
  return { summary: "Maker transaction failed. Review the technical details before retrying.", technical };
}

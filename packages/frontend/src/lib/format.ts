import { formatUnits } from "viem";

export function formatToken(value: bigint, decimals: number, maximumFractionDigits = 4): string {
  const raw = Number(formatUnits(value, decimals));
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(raw);
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function shortHex(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatPercent(value: number, digits = 1): string {
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: digits }).format(value);
}

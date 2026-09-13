export function tradeErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Transaction failed";
  if (/rejected|denied|4001/i.test(message)) return "Wallet request rejected.";
  if (/Soft reference liquidity is depleted|TakerTraitsAmountOutMustBeGreaterThanZero|0xf6ab88ca/i.test(message)) {
    return "The Soft reference strategy is depleted. Reseed it before requesting or executing another quote.";
  }
  if (/CommitmentExpired|0x4a50a71e/i.test(message)) return "Commitment expired — settle expiry.";
  if (/expired|QuoteExpired|0x1f99570c|lifetime/i.test(message)) return "The Firm quote expired. Request a new horizon quote.";
  if (/INSUFFICIENT_BOND|insufficient bond/i.test(message)) return "The maker no longer has enough available Bond for this quote.";
  if (/INSUFFICIENT_AQUA_CAPACITY|capacity/i.test(message)) return "Aqua capacity changed. Refresh depth and request a new Firm quote.";
  if (/nonce.*used|nonce.*unavailable/i.test(message)) return "The signed nonce is no longer available. Request a fresh Firm quote.";
  if (/chain mismatch|wrong network|expected 11155111/i.test(message)) return "Switch the wallet and runtime to Sepolia, then retry.";
  if (/insufficient.*balance/i.test(message)) return "Insufficient token balance for this action.";
  return readErrorMessage(cause, message);
}

export function readErrorMessage(cause: unknown, fallback = "Live protocol read failed"): string {
  const message = cause instanceof Error ? cause.message : fallback;
  if (/timed?\s*out|timeout|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(message)) {
    return "Live RPC/API read timed out. This is a transient connectivity failure, not a protocol failure. Retry the read.";
  }
  if (/failed to fetch|fetch failed|network error|ECONNRESET|ECONNREFUSED|socket hang up|429|rate.?limit|gateway timeout|temporarily unavailable/i.test(message)) {
    return "Live RPC/API read is temporarily unavailable. No protocol outcome was inferred. Retry the read.";
  }
  return message;
}

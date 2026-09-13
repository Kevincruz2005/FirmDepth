export function tradeErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Transaction failed";
  if (/rejected|denied|4001/i.test(message)) return "Wallet request rejected.";
  if (/Soft reference liquidity is depleted|TakerTraitsAmountOutMustBeGreaterThanZero|0xf6ab88ca/i.test(message)) {
    return "The Soft reference strategy is depleted. Reseed it before requesting or executing another quote.";
  }
  if (/expired|QuoteExpired|0x1f99570c|lifetime/i.test(message)) return "The Firm quote expired. Request a new horizon quote.";
  if (/INSUFFICIENT_BOND|insufficient bond/i.test(message)) return "The maker no longer has enough available Bond for this quote.";
  if (/INSUFFICIENT_AQUA_CAPACITY|capacity/i.test(message)) return "Aqua capacity changed. Refresh depth and request a new Firm quote.";
  if (/nonce.*used|nonce.*unavailable/i.test(message)) return "The signed nonce is no longer available. Request a fresh Firm quote.";
  if (/chain mismatch|wrong network|expected 11155111/i.test(message)) return "Switch the wallet and runtime to Sepolia, then retry.";
  if (/insufficient.*balance/i.test(message)) return "Insufficient token balance for this action.";
  return message;
}

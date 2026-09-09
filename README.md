# FirmDepth

**Firm Liquidity for 1inch Aqua**

Powered by Aqua — © Degensoft Ltd 2025  
Powered by SwapVM — © Degensoft Ltd 2025

FirmDepth adds a paid, fully bond-backed execution class around Aqua reusable liquidity.

This repository contains the backend MVP, pinned upstream integration notes, Solidity tests, TypeScript SDK, deterministic deployment script, and the Google AI Stitch prompt for the deferred frontend.

Start with [`START_HERE.md`](START_HERE.md).

## Core idea

Aqua allows the same maker wallet inventory to back multiple virtual strategies. FirmDepth preserves that reuse:

- **Soft**: best-effort Aqua execution, no extra bond.
- **Firm**: trader pays a premium, maker locks separate USDC collateral, and a custom SwapVM `FIRM_GUARD` validates the accepted commitment.

If the accepted Firm output is not currently executable from Aqua-backed maker inventory, the executor completes the economic exchange using the locked bond.

## MVP

- Official Aqua
- Modified official SwapVM
- `FIRM_GUARD`
- FirmDepth Registry
- Bond Vault
- Executor
- WETH -> USDC exact-input
- Deterministic local chain, with public-fork validation still pending
- Contract/SDK tests plus a complete Stitch UI design prompt

## Licensing

FirmDepth's SwapVM-linked contracts and instructions are published under `LicenseRef-Degensoft-SwapVM-1.1`; the unmodified Aqua deployment wrapper is published under `LicenseRef-Degensoft-Aqua-Source-1.1`. Full texts are preserved in `LICENSES/`.
- No Uniswap
- No runtime AI

## Build agent

Use [`CODEX_MASTER_PROMPT.md`](CODEX_MASTER_PROMPT.md).

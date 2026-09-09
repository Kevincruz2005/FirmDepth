# FirmDepth

**Firm Liquidity for 1inch Aqua**

FirmDepth adds a paid, fully bond-backed execution class around Aqua reusable liquidity.

This directory is currently a **Codex-ready build specification and engineering scaffold**. It deliberately does not pretend that unverified protocol code is already implemented. The coding agent must pin the current official Aqua/SwapVM sources, implement the protocol, run the required tests, and produce `FINAL_BUILD_REPORT.md`.

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
- Pinned local fork
- Tests + small UI
- No Uniswap
- No runtime AI

## Build agent

Use [`CODEX_MASTER_PROMPT.md`](CODEX_MASTER_PROMPT.md).

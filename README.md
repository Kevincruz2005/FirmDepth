# FirmDepth

**Bond-backed execution certainty for 1inch Aqua**

FirmDepth adds a paid, fully collateralized execution class around Aqua reusable liquidity. A trader accepts a maker-signed WETH-to-USDC quote, the protocol locks the quoted USDC minimum, and custom SwapVM instructions bind execution to that exact commitment.

## Why it exists

Aqua lets a maker reuse wallet inventory across virtual strategies. That is capital-efficient, but a Soft quote can become unexecutable when another strategy consumes the shared real balance or allowance.

FirmDepth preserves Aqua's self-custodial trading inventory while adding two deterministic terminal paths:

- **Aqua execution:** sufficient virtual balance, real balance, and allowance route through the official Aqua/SwapVM flow.
- **Collateral-backed settlement:** an inactive strategy or insufficient preflight capacity sends the trader input to the maker and releases the locked USDC minimum to the trader.

With sufficient capacity, the Aqua call is not caught. Any unrelated token, router, program, or SwapVM failure reverts the entire transaction and cannot consume the bond.

## Quick start

Requirements: Node.js 22+, npm, and Bash.

```bash
./scripts/demo_backend.sh
```

The script compiles the contracts and demonstrates Soft shared-liquidity exhaustion, Firm Aqua execution, collateral-backed settlement, and the SDK suite.

Run packages independently:

```bash
cd packages/contracts && npm ci && npm test
cd packages/sdk && npm ci && npm run build && npm test
```

## Core implementation

| Component | Purpose |
|---|---|
| [`FirmAquaSwapVMRouter.sol`](packages/contracts/contracts/FirmAquaSwapVMRouter.sol) | Extends the pinned official router with `FIRM_PRICE` and `FIRM_GUARD`. |
| [`FirmExecutor.sol`](packages/contracts/contracts/FirmExecutor.sol) | Validates orders, reads executable capacity, and finalizes exactly one settlement path. |
| [`FirmCommitmentRegistry.sol`](packages/contracts/contracts/FirmCommitmentRegistry.sol) | Verifies EIP-712/ERC-1271 quotes, prevents replay, escrows premiums, and owns commitment state. |
| [`BondVault.sol`](packages/contracts/contracts/BondVault.sol) | Maintains exact available/locked collateral accounting and commitment-specific locks. |
| [`FirmDepth.t.sol`](packages/contracts/test/FirmDepth.t.sol) | Exercises the official Aqua flow, custom opcodes, adversarial lifecycle cases, and asset invariants. |
| [`swapvm.ts`](packages/sdk/src/swapvm.ts) | Encodes the custom program and pinned SwapVM taker traits. |

## Verified status

- 20 Solidity tests passing, including 256 vault fuzz runs.
- 11 SDK tests passing after a clean TypeScript build.
- Deterministic local deployment and pinned Sepolia-state deployment validated.
- Public Sepolia deployment remains owner-operated because no funded key is stored in this repository.

See [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md) for the final adversarial analysis, [`FINAL_BUILD_REPORT.md`](FINAL_BUILD_REPORT.md) for the validation matrix, and [`docs/TESTNET.md`](docs/TESTNET.md) for the deployment runbook.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — product requirements and scope
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components and asset flow
- [`docs/CONTRACT_SPEC.md`](docs/CONTRACT_SPEC.md) — commitment, vault, and executor specification
- [`docs/SWAPVM_PLAN.md`](docs/SWAPVM_PLAN.md) — custom opcode design
- [`docs/UPSTREAM_VERSIONS.md`](docs/UPSTREAM_VERSIONS.md) — exact Aqua, SwapVM, and SDK pins
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — judge-facing demonstration plan

## Scope and licensing

This hackathon backend targets exact-input WETH-to-USDC commitments. It does not include Uniswap recovery, cross-chain behavior, undercollateralized credit, or a production audit. See [`LIMITATIONS.md`](LIMITATIONS.md).

Powered by Aqua — © Degensoft Ltd 2025<br>
Powered by SwapVM — © Degensoft Ltd 2025

FirmDepth's SwapVM-linked contracts and instructions use `LicenseRef-Degensoft-SwapVM-1.1`; the unmodified Aqua deployment wrapper uses `LicenseRef-Degensoft-Aqua-Source-1.1`. Full license texts are in [`LICENSES/`](LICENSES/).

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

## Pinned sponsor integration

- Aqua contracts: `9c5c42e5840e8741fba3597c48456c9510212b66`
- SwapVM contracts: `f09a41e689240adc645934f965c8061749397cd2`
- 1inch SDK repository reviewed: `364e7155167957e6a24320c7beb90539e06c91eb`
- Installed Aqua SDK: `@1inch/aqua-sdk@0.3.2`
- Solidity compiler: `0.8.30`

The repository preserves the official Aqua and SwapVM license texts and verifies pinned source hashes through `./scripts/verify_upstreams.sh`.

## Security and scope

This hackathon backend targets exact-input WETH-to-USDC commitments. It uses full output-token collateral, EIP-712 chain and contract binding, nonce replay protection, exact token balance-delta checks, a token allowlist, non-reentrancy, and single terminal commitment states.

It does not include Uniswap recovery, cross-chain behavior, undercollateralized credit, exotic ERC-20 support, or an independent production audit. The pinned sponsor dependency tree contains unresolved npm advisories and requires upstream-aware review before production use.

## Licensing

Powered by Aqua — © Degensoft Ltd 2025<br>
Powered by SwapVM — © Degensoft Ltd 2025

FirmDepth's SwapVM-linked contracts and instructions use `LicenseRef-Degensoft-SwapVM-1.1`; the unmodified Aqua deployment wrapper uses `LicenseRef-Degensoft-Aqua-Source-1.1`. Full license texts are in [`LICENSES/`](LICENSES/).

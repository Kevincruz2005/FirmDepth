# FirmDepth

**Bond-backed execution certainty for 1inch Aqua**

FirmDepth adds a paid, fully collateralized execution class to Aqua's reusable liquidity. A trader accepts a maker-signed WETH-to-USDC quote, the protocol locks its USDC minimum output, and modified SwapVM instructions bind the swap to that exact commitment.

## Why it can win

Aqua lets a maker reuse wallet inventory across virtual strategies. That is capital-efficient, but a Soft quote can lose execution capacity when a sibling strategy consumes the shared balance or allowance. Reserving the trading inventory would restore certainty by giving up Aqua's defining advantage.

FirmDepth instead reserves separate performance collateral only while a commitment is live:

- **Aqua path:** sufficient virtual balance, real wallet balance, and allowance execute through official Aqua with custom `FIRM_PRICE` and `FIRM_GUARD` SwapVM instructions.
- **Bond path:** an inactive strategy or deterministic output-capacity shortfall transfers the trader input to the maker and releases the locked USDC minimum to the trader.
- **Fail-closed path:** any unrelated token, router, malformed-program, or SwapVM failure reverts the entire transaction. It cannot consume the bond.

This keeps the maker's trading inventory reusable, makes accepted Firm commitments fully collateralized, and turns the key claim into reproducible onchain evidence rather than a UI promise.

## Verify in three minutes

Requirements: Node.js 22+, npm, Bash, and network access to Base RPC. An optional `BASE_RPC_URL` can override the public endpoint.

```bash
npm --prefix packages/contracts ci
npm --prefix packages/sdk ci
./scripts/demo_backend.sh
```

The release gate compiles the contracts, runs all unit/fuzz tests, builds and tests the SDK, verifies the official sponsor contracts at pinned Base block `51,123,118`, executes the adversarial fork demo, then regenerates and validates the deterministic benchmark.

For a focused judge demo:

```bash
npm --prefix packages/contracts run fork:base:check
npm --prefix packages/contracts run fork:base:demo
```

The fork demo discovers a real USDC holder from historical Base logs and uses real Base WETH, USDC, and official Aqua state. It proves:

1. a Firm commitment settles through Aqua;
2. one Soft strategy drains shared maker inventory;
3. its overlapping Soft sibling fails atomically onchain;
4. an already accepted Firm commitment settles exactly once from its locked bond;
5. a new under-capacity commitment is rejected;
6. final vault liabilities reconcile to the actual USDC balance.

## Core implementation

| Component | Purpose |
|---|---|
| [`FirmAquaSwapVMRouter.sol`](packages/contracts/contracts/FirmAquaSwapVMRouter.sol) | Extends the pinned official SwapVM router with `FIRM_PRICE` and `FIRM_GUARD`. |
| [`FirmExecutor.sol`](packages/contracts/contracts/FirmExecutor.sol) | Performs deterministic capacity classification and finalizes exactly one settlement path. |
| [`FirmCommitmentRegistry.sol`](packages/contracts/contracts/FirmCommitmentRegistry.sol) | Verifies EIP-712/ERC-1271 quotes, prevents replay, escrows token-in premiums, and owns commitment state. |
| [`BondVault.sol`](packages/contracts/contracts/BondVault.sol) | Maintains exact available/locked collateral accounting and commitment-specific locks. |
| [`FirmDepth.t.sol`](packages/contracts/test/FirmDepth.t.sol) | Covers official Aqua execution, custom instructions, lifecycle attacks, signatures, atomicity, and asset invariants. |
| [`actions.ts`](packages/sdk/src/actions.ts) | Simulates every state-changing Firm action before wallet submission. |
| [`base-fork-demo.json`](packages/contracts/evidence/base-fork-demo.json) | Records the canonical Base fork transactions, gas, terminal states, and reconciled balances. |

## Verified backend

- 49 Solidity tests pass, including two vault/accounting invariants at 1,024 fuzz runs each.
- 17 TypeScript SDK tests pass after a clean build.
- 810,000 seeded simulation episodes cover 81 parameter configurations across quote size, TTL, shared-liquidity ratio, and bond utilization.
- The highest-loss admitted benchmark scenario observes 5,853 Soft capacity losses out of 10,000 episodes; the same seeded Firm scenario settles 4,147 through Aqua and 5,853 through locked collateral. These are synthetic stress results, not claimed real-network failure rates.
- The canonical fork evidence uses Base chain ID `8453`, official Aqua `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`, official SwapVM `0x111111338c5091e8440b67b168bae16a668ac0de`, Base WETH, and Base USDC.

Benchmark inputs and outputs are in [`packages/benchmark/`](packages/benchmark/). Regenerate them with:

```bash
npm --prefix packages/benchmark run benchmark
npm --prefix packages/benchmark test
```

## Safety model

The backend targets exact-input WETH-to-USDC commitments. Every signed quote binds the chain, verifying contract, maker, taker, executor, router, order hash, token pair, amount, minimum output, expiry, nonce, bond, and pricing snapshot.

Acceptance requires an active Aqua strategy plus sufficient virtual balance, real maker balance, maker allowance, static quoted output, and free bond collateral. Execution rechecks only the deterministic Aqua capacity signals before pulling trader input. If capacity is sufficient, the Aqua call is deliberately not caught: unknown failures revert all nested and outer state. Reentrancy protection and single terminal states prevent dual settlement, replay, or double release.

## Sponsor integration and deployment scope

- Aqua source pinned at `9c5c42e5840e8741fba3597c48456c9510212b66`.
- SwapVM source pinned at `f09a41e689240adc645934f965c8061749397cd2`.
- `@1inch/aqua-sdk@0.3.2` and `@1inch/solidity-utils@6.9.10`.
- Solidity `0.8.30` with optimizer and IR compilation enabled.

The [official Aqua repository](https://github.com/1inch/aqua) lists deterministic deployments on production networks, not Sepolia. FirmDepth therefore uses a pinned Base fork as its canonical sponsor-qualification proof. The included Sepolia scripts require the operator to supply and validate a compatible Aqua deployment plus funded credentials; no public-testnet deployment is claimed by this repository.

The SDK production dependency audit is clean. The contract workspace inherits advisories through the pinned 1inch Solidity utility/tooling dependency graph; those packages are not linked into deployed bytecode, but remain an upstream tooling risk when processing untrusted input. Sponsor versions are intentionally pinned rather than upgraded solely to silence audit output.

FirmDepth does not include Uniswap recovery, cross-chain behavior, undercollateralized credit, exotic ERC-20 support, or an independent production audit.

## Licensing

Powered by Aqua — © Degensoft Ltd 2025<br>
Powered by SwapVM — © Degensoft Ltd 2025

FirmDepth's SwapVM-linked contracts and instructions use `LicenseRef-Degensoft-SwapVM-1.1`; the unmodified Aqua deployment wrapper uses `LicenseRef-Degensoft-Aqua-Source-1.1`. Full license texts are in [`LICENSES/`](LICENSES/).

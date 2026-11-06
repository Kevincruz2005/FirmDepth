# Mumbai Continuity changelog

Work dates: November 6–7, 2026 (Asia/Kolkata). Entries describe work performed during this session; Git retains the actual commit timestamps.

Starting state: `89c4a7910f054042872927a29e162538f6fa7b65`. FirmDepth's original quote registry, executor, bond vault, Aqua/SwapVM integration, pricing and public Sepolia deployment already existed.

- `5f64174`: Added ProtectedSettlement with immutable payer-owned plans, separate WETH funding, contract-taker acceptance, atomic payouts, surplus handling and expiry refunds. Tested both settlement paths, rollback, authorization, replay, and escrow isolation.
- `da5ebea`: Added settlement ABI and SDK actions, deployment authentication and receipt integration; added the settlement quote request boundary and service tests.
- `8ef5e2f`: Added `/settlement`, wallet-driven creation/funding/acceptance/execution/refunds, chain recovery, receipt inspection, responsive styling and real fork browser tests. Kept Trade first in navigation to preserve keyboard focus behavior.
- Final verification milestone: Expanded adversarial tests to 82 passing Solidity cases across the complete suite. Added reproducible local deployment/demo/verification scripts, truthful fork evidence, a separate deployment manifest and architecture/security documentation. The clean-start run passed contract, SDK, service, frontend, benchmark and browser gates.

Mumbai additions use the original official Aqua integration and modified SwapVM router. They extend the existing product into downstream payments; they do not replace the underlying technology.

Verified scaled judge example: 120/80 USDC allocations. The normal plan settled through Aqua; the second accepted plan paid both recipients through bond collateral after a real sibling Aqua swap drained maker output inventory to 100 USDC. A mined, explicitly labeled local-fork fault injection reverted without consuming principal or collateral. Full transaction hashes, addresses and balance deltas are in the fork evidence file.

## Aave repayment extension

Repayment starts from the completed Protected Settlement baseline `2d823188e981ea44f97dd6421fe2c1638ea8d027`. The original contracts and public Sepolia payout deployment remain unchanged.

- `dcd8643`: Checked the official Aave Base market and actual reserve contracts on the pinned fork.
- `3f53147`: Composed an immutable, payer-authorized variable-debt repayment action around Protected Settlement, with adversarial contract coverage.
- `ac7e370`: Added SDK identity checks, plan actions and combined FirmDepth/Aave receipt verification.
- `b3e2fa3`: Verified scaled debt burns using the actual normalized Aave debt index.
- `669e76a`: Kept expiry refunds available independently of Aave reserve availability.
- `3a35a8d`: Executed actual Aave borrowing, Aqua and bond repayments, surplus, expiry and a mined downstream rollback on the local fork.
- `c78359e`: Recorded the real public Sepolia token incompatibility instead of substituting another asset.
- `9c8eee1`: Added the Debt Repayment frontend mode, verified debt/receipts, wallet-fork checks and five real fork browser scenarios.

The new action uses Aave's existing repayment operation. FirmDepth supplies the pre-existing collateral-backed swap commitment, Protected Settlement supplies its pre-existing escrow and atomic payout lifecycle, and this addition binds and verifies a downstream repayment. See [architecture, limitations and reproduction](protected-debt-repayment.md).

Final clean-fork verification passed 121 Solidity, 39 SDK, 12 quote-service, 33 frontend unit, 8 benchmark and 33 browser tests (25 original, 3 payouts, 5 repayment). The retained node contains verified Aqua and covered-bond repayments of 200 USDC each, a full close of the smaller remaining debt with 99.999923 USDC returned, expiry recovery and an actual reverted Pool repayment with atomic rollback. The deployment manifest records a separate fresh interactive 600-USDC position. Frontend builds pass; lint reports zero errors and one pre-existing payout effect warning. No private environment credentials or generated build/test output are included.

## Separate Azure fork hosting

- `755d222`: Added the isolated hosted-fork application, restricted RPC, operator authentication, immutable-plan quote integration, hosted labels and actual browser coverage. Frontend unit coverage increased to 35 cases; six gateway policy tests pass.
- `d93e857`: Staged the package in private Azure Blob Storage for asynchronous Azure-to-Azure deployment, avoiding stalled client uploads.
- `acb8565`: Preserved empty runtime evidence directories and added independent checks for actual Aave borrow transactions and a stable fork generation during receipt verification.

The dedicated Azure site passed all three hosted browser scenarios and independently verified real Aave repayment through Aqua and covered bond, surplus, expiry and rollback. Azure evidence is recorded separately from local and Sepolia evidence. The original public Sepolia site/API remained healthy and unchanged.

Documentation was reorganized into a shorter project README, a step-by-step local application walkthrough and a separate core architecture guide. Full hosting details and limitations are in [the Azure fork runbook](azure-debt-demo.md).

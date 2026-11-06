# Mumbai Continuity changelog

Work date: November 6, 2026. Entries describe work performed during this session; Git retains the actual commit timestamps.

Starting state: `89c4a7910f054042872927a29e162538f6fa7b65`. FirmDepth's original quote registry, executor, bond vault, Aqua/SwapVM integration, pricing and public Sepolia deployment already existed.

- `5f64174`: Added ProtectedSettlement with immutable payer-owned plans, separate WETH funding, contract-taker acceptance, atomic payouts, surplus handling and expiry refunds. Tested both settlement paths, rollback, authorization, replay, and escrow isolation.
- `da5ebea`: Added settlement ABI and SDK actions, deployment authentication and receipt integration; added the settlement quote request boundary and service tests.
- `8ef5e2f`: Added `/settlement`, wallet-driven creation/funding/acceptance/execution/refunds, chain recovery, receipt inspection, responsive styling and real fork browser tests. Kept Trade first in navigation to preserve keyboard focus behavior.
- Final verification milestone: Expanded adversarial tests to 82 passing Solidity cases across the complete suite. Added reproducible local deployment/demo/verification scripts, truthful fork evidence, a separate deployment manifest and architecture/security documentation. The clean-start run passed contract, SDK, service, frontend, benchmark and browser gates.

Mumbai additions use the original official Aqua integration and modified SwapVM router. They extend the existing product into downstream payments; they do not replace the underlying technology.

Verified scaled judge example: 120/80 USDC allocations. The normal plan settled through Aqua; the second accepted plan paid both recipients through bond collateral after a real sibling Aqua swap drained maker output inventory to 100 USDC. A mined, explicitly labeled local-fork fault injection reverted without consuming principal or collateral. Full transaction hashes, addresses and balance deltas are in the fork evidence file.

Next: collect recipient feedback and assess production deployment requirements while retaining the narrow exact-transfer token and covered-capacity guarantees.

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

enum CommitmentStatus {
    NONE,
    ACCEPTED,
    FILLED_AQUA,
    FILLED_BOND,
    EXPIRED
}

struct FirmQuote {
    address maker;
    address taker;
    address executor;
    address swapRouter;
    bytes32 orderHash;
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint256 referenceAmountOut;
    uint256 minAmountOut;
    uint256 requiredBond;
    address premiumToken;
    uint256 premiumAmount;
    uint32 pricingVersion;
    uint256 sigmaWad;
    uint256 annualCapitalRateWad;
    uint16 capacityKBps;
    uint256 utilizationAfterWad;
    uint256 minPremiumOut;
    uint64 expiry;
    uint256 nonce;
}

struct Commitment {
    FirmQuote quote;
    CommitmentStatus status;
    uint64 acceptedAt;
    uint64 settledAt;
}

interface IFirmCommitmentRegistry {
    function getCommitment(bytes32 commitmentId) external view returns (Commitment memory);

    function finalizeAqua(bytes32 commitmentId) external;

    function finalizeBond(bytes32 commitmentId) external;
}

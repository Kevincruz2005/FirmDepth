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
    address trader;
    address executor;
    bytes32 orderHash;
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint256 minOut;
    uint256 premium;
    uint256 requiredBond;
    uint64 expiry;
    uint256 nonce;
    uint256 chainId;
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

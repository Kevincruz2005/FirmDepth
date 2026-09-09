// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";

import { Commitment, CommitmentStatus, IFirmCommitmentRegistry } from "../types/FirmTypes.sol";

library FirmPrice {
    using ContextLib for Context;

    uint8 internal constant OPCODE = 0x52;

    error UnexpectedStaticArgs(uint256 length);
    error MissingCommitmentId();
    error CommitmentNotAccepted(bytes32 commitmentId);
    error ExactInputRequired();
    error InputAmountMismatch(uint256 expected, uint256 actual);

    function exec(Context memory ctx, bytes calldata args, IFirmCommitmentRegistry registry) internal view {
        if (args.length != 0) revert UnexpectedStaticArgs(args.length);
        bytes calldata dynamicArgs = ctx.tryChopTakerArgs(32);
        if (dynamicArgs.length != 32) revert MissingCommitmentId();
        bytes32 commitmentId;
        assembly ("memory-safe") {
            commitmentId := calldataload(dynamicArgs.offset)
        }

        Commitment memory commitment = registry.getCommitment(commitmentId);
        if (commitment.status != CommitmentStatus.ACCEPTED || block.timestamp > commitment.quote.expiry) {
            revert CommitmentNotAccepted(commitmentId);
        }
        if (!ctx.query.isExactIn) revert ExactInputRequired();
        if (ctx.swap.amountIn != commitment.quote.amountIn) {
            revert InputAmountMismatch(commitment.quote.amountIn, ctx.swap.amountIn);
        }
        ctx.swap.amountOut = commitment.quote.minOut;
    }
}

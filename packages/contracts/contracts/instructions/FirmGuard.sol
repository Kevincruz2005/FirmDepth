// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";

import { BondVault } from "../BondVault.sol";
import { Commitment, CommitmentStatus, IFirmCommitmentRegistry } from "../types/FirmTypes.sol";

library FirmGuard {
    using ContextLib for Context;

    uint8 internal constant OPCODE = 0x21;

    error UnexpectedStaticArgs(uint256 length);
    error MissingCommitmentId();
    error CommitmentNotAccepted(bytes32 commitmentId);
    error CommitmentExpired(uint64 expiry);
    error MakerMismatch(address expected, address actual);
    error ExecutorMismatch(address expected, address actual);
    error OrderMismatch(bytes32 expected, bytes32 actual);
    error TokenInMismatch(address expected, address actual);
    error TokenOutMismatch(address expected, address actual);
    error InputAmountMismatch(uint256 expected, uint256 actual);
    error OutputAmountMismatch(uint256 expected, uint256 actual);
    error BondMismatch(address maker, uint256 expected, uint256 actual);
    error ExactInputRequired();

    function exec(
        Context memory ctx,
        bytes calldata args,
        IFirmCommitmentRegistry registry,
        BondVault vault
    ) internal view {
        if (args.length != 0) revert UnexpectedStaticArgs(args.length);
        bytes calldata dynamicArgs = ctx.tryChopTakerArgs(32);
        if (dynamicArgs.length != 32) revert MissingCommitmentId();
        bytes32 commitmentId;
        assembly ("memory-safe") {
            commitmentId := calldataload(dynamicArgs.offset)
        }

        Commitment memory commitment = registry.getCommitment(commitmentId);
        if (commitment.status != CommitmentStatus.ACCEPTED) revert CommitmentNotAccepted(commitmentId);
        if (block.timestamp > commitment.quote.expiry) revert CommitmentExpired(commitment.quote.expiry);
        if (!ctx.query.isExactIn) revert ExactInputRequired();
        if (ctx.query.maker != commitment.quote.maker) revert MakerMismatch(commitment.quote.maker, ctx.query.maker);
        if (ctx.query.taker != commitment.quote.executor) revert ExecutorMismatch(commitment.quote.executor, ctx.query.taker);
        if (ctx.query.orderHash != commitment.quote.orderHash) {
            revert OrderMismatch(commitment.quote.orderHash, ctx.query.orderHash);
        }
        if (ctx.query.tokenIn != commitment.quote.tokenIn) {
            revert TokenInMismatch(commitment.quote.tokenIn, ctx.query.tokenIn);
        }
        if (ctx.query.tokenOut != commitment.quote.tokenOut) {
            revert TokenOutMismatch(commitment.quote.tokenOut, ctx.query.tokenOut);
        }
        if (ctx.swap.amountIn != commitment.quote.amountIn) {
            revert InputAmountMismatch(commitment.quote.amountIn, ctx.swap.amountIn);
        }
        if (ctx.swap.amountOut != commitment.quote.minOut) {
            revert OutputAmountMismatch(commitment.quote.minOut, ctx.swap.amountOut);
        }

        (address bondMaker, uint256 lockedBond) = vault.lockedFor(commitmentId);
        if (bondMaker != commitment.quote.maker || lockedBond != commitment.quote.requiredBond) {
            revert BondMismatch(bondMaker, commitment.quote.requiredBond, lockedBond);
        }
    }
}

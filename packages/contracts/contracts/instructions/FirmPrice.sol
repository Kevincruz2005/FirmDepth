// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";

import { FirmPricing } from "../libraries/FirmPricing.sol";
import { Commitment, CommitmentStatus, IFirmCommitmentRegistry } from "../types/FirmTypes.sol";

library FirmPrice {
    using ContextLib for Context;

    uint8 internal constant OPCODE = 0x52;

    error UnexpectedStaticArgs(uint256 length);
    error MissingFirmAmountOut();
    error MissingCommitmentId();
    error ExactInputRequired();
    error ZeroFirmAmountOut();
    error CommitmentNotAccepted(bytes32 commitmentId);
    error OutputMismatch(uint256 expected, uint256 actual);
    error PricingVersionMismatch(uint32 expected, uint32 actual);
    error PremiumMismatch(uint256 expected, uint256 actual);

    function exec(Context memory ctx, bytes calldata args, IFirmCommitmentRegistry registry) internal view {
        if (args.length != 0) revert UnexpectedStaticArgs(args.length);
        bytes calldata dynamicArgs = ctx.tryChopTakerArgs(32);
        if (dynamicArgs.length != 32) revert MissingFirmAmountOut();
        if (!ctx.query.isExactIn) revert ExactInputRequired();
        uint256 amountOut = uint256(bytes32(dynamicArgs));
        if (amountOut == 0) revert ZeroFirmAmountOut();
        ctx.swap.amountOut = amountOut;
        if (ctx.vm.isStaticContext) return;

        bytes calldata remainingArgs = ctx.takerArgs();
        if (remainingArgs.length != 32) revert MissingCommitmentId();
        bytes32 commitmentId = bytes32(remainingArgs);
        Commitment memory commitment = registry.getCommitment(commitmentId);
        if (commitment.status != CommitmentStatus.ACCEPTED) revert CommitmentNotAccepted(commitmentId);
        if (amountOut != commitment.quote.minAmountOut) {
            revert OutputMismatch(commitment.quote.minAmountOut, amountOut);
        }
        if (commitment.quote.pricingVersion != FirmPricing.PRICING_VERSION) {
            revert PricingVersionMismatch(FirmPricing.PRICING_VERSION, commitment.quote.pricingVersion);
        }

        FirmPricing.Result memory pricing = FirmPricing.quote(FirmPricing.Inputs({
            amountIn: commitment.quote.amountIn,
            referenceAmountOut: commitment.quote.referenceAmountOut,
            minAmountOut: commitment.quote.minAmountOut,
            requiredBond: commitment.quote.requiredBond,
            sigmaWad: commitment.quote.sigmaWad,
            annualCapitalRateWad: commitment.quote.annualCapitalRateWad,
            capacityKBps: commitment.quote.capacityKBps,
            utilizationAfterWad: commitment.quote.utilizationAfterWad,
            minPremiumOut: commitment.quote.minPremiumOut,
            ttl: commitment.quote.pricingTtl
        }));
        if (pricing.premiumIn != commitment.quote.premiumAmount) {
            revert PremiumMismatch(pricing.premiumIn, commitment.quote.premiumAmount);
        }
    }
}

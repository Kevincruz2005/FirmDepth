// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

library FirmPricing {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant WAD_SQUARED = 1e36;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant YEAR = 31_536_000;
    uint256 internal constant INV_SQRT_2PI_WAD = 398_942_280_401_432_678;
    uint32 internal constant PRICING_VERSION = 2;
    uint256 internal constant MAX_TTL = 300;
    uint256 internal constant MAX_SIGMA_WAD = 5e18;
    uint256 internal constant MAX_ANNUAL_CAPITAL_RATE_WAD = 2e18;
    uint16 internal constant MAX_CAPACITY_K_BPS = 2_000;

    struct Inputs {
        uint256 amountIn;
        uint256 referenceAmountOut;
        uint256 minAmountOut;
        uint256 requiredBond;
        uint256 sigmaWad;
        uint256 annualCapitalRateWad;
        uint16 capacityKBps;
        uint256 utilizationAfterWad;
        uint256 minPremiumOut;
        uint256 ttl;
    }

    struct Result {
        uint256 sqrtTimeWad;
        uint256 optionalityOut;
        uint256 bondCarryOut;
        uint256 capacitySurchargeOut;
        uint256 premiumOut;
        uint256 premiumIn;
    }

    error ZeroAmountIn();
    error ZeroReferenceAmountOut();
    error ZeroMinAmountOut();
    error InsufficientBond(uint256 requiredBond, uint256 minAmountOut);
    error TtlOutOfRange(uint256 ttl);
    error SigmaOutOfRange(uint256 sigmaWad);
    error CapitalRateOutOfRange(uint256 annualCapitalRateWad);
    error CapacityKOutOfRange(uint16 capacityKBps);
    error UtilizationOutOfRange(uint256 utilizationAfterWad);

    function quote(Inputs memory inputs) internal pure returns (Result memory result) {
        validate(inputs);

        result.sqrtTimeWad = Math.sqrt(Math.mulDiv(inputs.ttl, WAD_SQUARED, YEAR));

        uint256 volatilityOut = Math.mulDiv(inputs.referenceAmountOut, inputs.sigmaWad, WAD);
        uint256 timeAdjustedOut = Math.mulDiv(volatilityOut, result.sqrtTimeWad, WAD);
        result.optionalityOut = Math.mulDiv(timeAdjustedOut, INV_SQRT_2PI_WAD, WAD);

        uint256 annualCarryOut = Math.mulDiv(inputs.requiredBond, inputs.annualCapitalRateWad, WAD);
        result.bondCarryOut = Math.mulDiv(annualCarryOut, inputs.ttl, YEAR);

        uint256 utilizationSquaredWad = Math.mulDiv(
            inputs.utilizationAfterWad,
            inputs.utilizationAfterWad,
            WAD
        );
        uint256 capacityRateOut = Math.mulDiv(inputs.referenceAmountOut, inputs.capacityKBps, BPS);
        result.capacitySurchargeOut = Math.mulDiv(capacityRateOut, utilizationSquaredWad, WAD);

        uint256 calculatedPremiumOut = result.optionalityOut
            + result.bondCarryOut
            + result.capacitySurchargeOut;
        result.premiumOut = Math.max(inputs.minPremiumOut, calculatedPremiumOut);
        result.premiumIn = Math.mulDiv(
            result.premiumOut,
            inputs.amountIn,
            inputs.referenceAmountOut,
            Math.Rounding.Ceil
        );
    }

    function validate(Inputs memory inputs) internal pure {
        if (inputs.amountIn == 0) revert ZeroAmountIn();
        if (inputs.referenceAmountOut == 0) revert ZeroReferenceAmountOut();
        if (inputs.minAmountOut == 0) revert ZeroMinAmountOut();
        if (inputs.requiredBond < inputs.minAmountOut) {
            revert InsufficientBond(inputs.requiredBond, inputs.minAmountOut);
        }
        if (inputs.ttl == 0 || inputs.ttl > MAX_TTL) revert TtlOutOfRange(inputs.ttl);
        if (inputs.sigmaWad > MAX_SIGMA_WAD) revert SigmaOutOfRange(inputs.sigmaWad);
        if (inputs.annualCapitalRateWad > MAX_ANNUAL_CAPITAL_RATE_WAD) {
            revert CapitalRateOutOfRange(inputs.annualCapitalRateWad);
        }
        if (inputs.capacityKBps > MAX_CAPACITY_K_BPS) revert CapacityKOutOfRange(inputs.capacityKBps);
        if (inputs.utilizationAfterWad > WAD) revert UtilizationOutOfRange(inputs.utilizationAfterWad);
    }
}

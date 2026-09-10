// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { FirmPricing } from "../contracts/libraries/FirmPricing.sol";

contract FirmPricingHarness {
    function quote(FirmPricing.Inputs calldata inputs) external pure returns (FirmPricing.Result memory) {
        return FirmPricing.quote(inputs);
    }
}

contract FirmPricingTest is Test {
    uint256 private constant AMOUNT_IN = 0.2 ether;
    uint256 private constant REFERENCE_OUT = 700e6;
    uint256 private constant MIN_OUT = 690e6;

    FirmPricingHarness private harness;

    function setUp() public {
        harness = new FirmPricingHarness();
    }

    function testFiveSecondVector() public pure {
        FirmPricing.Result memory result = FirmPricing.quote(_inputs(5));
        _assertResult(result, 398_182_068_806_247, 88_956, 10, 388_517, 477_483, 136_423_714_285_715);
    }

    function testThirtySecondVector() public pure {
        FirmPricing.Result memory result = FirmPricing.quote(_inputs(30));
        _assertResult(result, 975_342_893_301_088, 217_899, 65, 388_517, 606_481, 173_280_285_714_286);
    }

    function testOneHundredTwentySecondVector() public pure {
        FirmPricing.Result memory result = FirmPricing.quote(_inputs(120));
        _assertResult(result, 1_950_685_786_602_176, 435_798, 262, 388_517, 824_577, 235_593_428_571_429);
    }

    function testFinalTokenInConversionRoundsUp() public pure {
        FirmPricing.Inputs memory inputs = _inputs(5);
        inputs.amountIn = 1;
        inputs.referenceAmountOut = 3;
        inputs.minAmountOut = 1;
        inputs.requiredBond = 1;
        inputs.sigmaWad = 0;
        inputs.annualCapitalRateWad = 0;
        inputs.capacityKBps = 0;
        inputs.utilizationAfterWad = 0;
        inputs.minPremiumOut = 1;

        assertEq(FirmPricing.quote(inputs).premiumIn, 1);
    }

    function testPricingIsMonotonicForTtlAndUtilization() public pure {
        FirmPricing.Result memory shortTtl = FirmPricing.quote(_inputs(5));
        FirmPricing.Result memory longTtl = FirmPricing.quote(_inputs(120));
        assertGt(longTtl.premiumIn, shortTtl.premiumIn);

        FirmPricing.Inputs memory lowerUtilization = _inputs(30);
        lowerUtilization.utilizationAfterWad = 500_000_000_000_000_000;
        assertGt(FirmPricing.quote(_inputs(30)).premiumIn, FirmPricing.quote(lowerUtilization).premiumIn);
    }

    function testRejectsOutOfRangeInputs() public {
        FirmPricing.Inputs memory inputs = _inputs(30);

        inputs.requiredBond = MIN_OUT - 1;
        vm.expectRevert(abi.encodeWithSelector(FirmPricing.InsufficientBond.selector, MIN_OUT - 1, MIN_OUT));
        harness.quote(inputs);

        inputs = _inputs(301);
        vm.expectRevert(abi.encodeWithSelector(FirmPricing.TtlOutOfRange.selector, 301));
        harness.quote(inputs);

        inputs = _inputs(30);
        inputs.sigmaWad = 5e18 + 1;
        vm.expectRevert(abi.encodeWithSelector(FirmPricing.SigmaOutOfRange.selector, 5e18 + 1));
        harness.quote(inputs);

        inputs = _inputs(30);
        inputs.annualCapitalRateWad = 2e18 + 1;
        vm.expectRevert(abi.encodeWithSelector(FirmPricing.CapitalRateOutOfRange.selector, 2e18 + 1));
        harness.quote(inputs);

        inputs = _inputs(30);
        inputs.capacityKBps = 2_001;
        vm.expectRevert(abi.encodeWithSelector(FirmPricing.CapacityKOutOfRange.selector, uint16(2_001)));
        harness.quote(inputs);

        inputs = _inputs(30);
        inputs.utilizationAfterWad = 1e18 + 1;
        vm.expectRevert(abi.encodeWithSelector(FirmPricing.UtilizationOutOfRange.selector, 1e18 + 1));
        harness.quote(inputs);
    }

    function _inputs(uint256 ttl) private pure returns (FirmPricing.Inputs memory) {
        return FirmPricing.Inputs({
            amountIn: AMOUNT_IN,
            referenceAmountOut: REFERENCE_OUT,
            minAmountOut: MIN_OUT,
            requiredBond: MIN_OUT,
            sigmaWad: 800_000_000_000_000_000,
            annualCapitalRateWad: 100_000_000_000_000_000,
            capacityKBps: 10,
            utilizationAfterWad: 745_000_000_000_000_000,
            minPremiumOut: 100_000,
            ttl: ttl
        });
    }

    function _assertResult(
        FirmPricing.Result memory result,
        uint256 sqrtTimeWad,
        uint256 optionalityOut,
        uint256 bondCarryOut,
        uint256 capacitySurchargeOut,
        uint256 premiumOut,
        uint256 premiumIn
    ) private pure {
        assertEq(result.sqrtTimeWad, sqrtTimeWad);
        assertEq(result.optionalityOut, optionalityOut);
        assertEq(result.bondCarryOut, bondCarryOut);
        assertEq(result.capacitySurchargeOut, capacitySurchargeOut);
        assertEq(result.premiumOut, premiumOut);
        assertEq(result.premiumIn, premiumIn);
    }
}

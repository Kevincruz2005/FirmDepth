import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { scenarios, simulateScenario, type BenchmarkConfig } from "../src/model.ts";

const config = JSON.parse(
  await readFile(new URL("../config/main.json", import.meta.url), "utf8"),
) as BenchmarkConfig;

test("expands every declared q, ttl, SLR, and utilization configuration", () => {
  assert.equal(
    scenarios(config).length,
    config.qFractions.length
      * config.ttls.length
      * config.sharedLiquidityRatios.length
      * config.bondUtilizations.length,
  );
});

test("produces deterministic compound-Poisson results", () => {
  const scenario = scenarios(config)[0];
  assert.ok(scenario);
  assert.deepEqual(
    simulateScenario(config, scenario, 0),
    simulateScenario(config, scenario, 0),
  );
});

test("settles every admitted Firm episode through exactly one path", () => {
  for (const [index, scenario] of scenarios(config).entries()) {
    const result = simulateScenario(config, scenario, index);
    assert.equal(
      result.firmDepth.filledAqua + result.firmDepth.filledBond,
      result.firmDepth.admitted,
    );
    assert.equal(
      result.firmDepth.protectedSettlements + result.firmDepth.admissionRejected,
      result.episodes,
    );
  }
});

test("models Firm liquidity reuse without hard reservation", () => {
  const scenario = scenarios(config)[0];
  assert.ok(scenario);
  const result = simulateScenario(config, scenario, 0);
  assert.equal(result.firmDepth.siblingDemandServed, result.soft.siblingDemandServed);
  assert.ok(result.hardReservation.siblingDemandServed <= result.soft.siblingDemandServed);
  assert.equal(result.soft.normalizedLockCost, 0);
});

test("rejects a Firm quote when the declared bond utilization leaves too little collateral", () => {
  const scenario = scenarios(config).find(
    ({ qFraction, bondUtilization }) => qFraction === 0.4 && bondUtilization === 0.9,
  );
  assert.ok(scenario);
  const result = simulateScenario(config, scenario, 0);
  assert.equal(result.firmDepth.admitted, 0);
  assert.equal(result.firmDepth.admissionRejected, config.episodes);
});

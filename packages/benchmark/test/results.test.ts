import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const raw = JSON.parse(
  await readFile(new URL("../results/raw.json", import.meta.url), "utf8"),
);
const receipt = JSON.parse(
  await readFile(new URL("../results/adversarial-receipt.json", import.meta.url), "utf8"),
);

test("records at least ten thousand episodes for every declared configuration", () => {
  assert.equal(raw.results.length, raw.declaredConfigurations);
  assert.ok(raw.results.length > 0);
  for (const result of raw.results) assert.ok(result.episodes >= 10_000);
  assert.equal(raw.simulatedEpisodes, raw.results.length * raw.config.episodes);
});

test("uses measured official-fork gas evidence", () => {
  assert.equal(raw.gasEvidence.chainId, 8453);
  assert.match(raw.gasEvidence.officialAqua, /^0x111111/i);
  assert.ok(raw.gasEvidence.observedFirmAcceptance > 0);
  assert.ok(raw.gasEvidence.observedFirmAquaExecution > 0);
  assert.ok(raw.gasEvidence.observedFirmBondExecution > 0);
  assert.equal(raw.gasEvidence.hardReservation, null);
});

test("adversarial receipt is generated from a raw benchmark row", () => {
  const match = raw.results.find((result: { seed: number }) => result.seed === receipt.scenario.seed);
  assert.ok(match);
  assert.equal(receipt.observedCounts.softAvailabilityLoss, match.soft.availabilityLoss);
  assert.equal(receipt.observedCounts.firmFilledAqua, match.firmDepth.filledAqua);
  assert.equal(receipt.observedCounts.firmFilledBond, match.firmDepth.filledBond);
});

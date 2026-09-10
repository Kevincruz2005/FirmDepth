import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  scenarios,
  simulateScenario,
  type BenchmarkConfig,
  type ScenarioResult,
} from "./model.ts";

interface ForkEvidence {
  chainId: number;
  forkBlock: number;
  officialContracts: { aqua: string };
  aquaPath: {
    acceptanceGasUsed: string;
    executionGasUsed: string;
    executionTransactionHash: string;
  };
  bondPath: {
    acceptanceGasUsed: string;
    executionGasUsed: string;
    executionTransactionHash: string;
  };
  sharedLiquidityDrain: { swapGasUsed: string };
}

const configUrl = new URL("../config/main.json", import.meta.url);
const config = JSON.parse(await readFile(configUrl, "utf8")) as BenchmarkConfig;
const forkEvidence = JSON.parse(
  await readFile(new URL(config.gasEvidence, configUrl), "utf8"),
) as ForkEvidence;

const gas = {
  observedSoftSwap: Number(forkEvidence.sharedLiquidityDrain.swapGasUsed),
  observedFirmAcceptance: mean([
    Number(forkEvidence.aquaPath.acceptanceGasUsed),
    Number(forkEvidence.bondPath.acceptanceGasUsed),
  ]),
  observedFirmAquaExecution: Number(forkEvidence.aquaPath.executionGasUsed),
  observedFirmBondExecution: Number(forkEvidence.bondPath.executionGasUsed),
};

const results = scenarios(config).map((scenario, index) => {
  const result = simulateScenario(config, scenario, index);
  const accepted = result.firmDepth.admitted;
  const expectedFirmGasPerAccepted = accepted === 0
    ? null
    : gas.observedFirmAcceptance
      + (result.firmDepth.filledAqua / accepted) * gas.observedFirmAquaExecution
      + (result.firmDepth.filledBond / accepted) * gas.observedFirmBondExecution;
  return { ...result, gas: { ...gas, expectedFirmGasPerAccepted } };
});

const rawData = {
  schemaVersion: "1",
  generatedBy: "packages/benchmark/src/run.ts",
  model: {
    arrivalProcess: "compound_poisson_simulation",
    arrivalIntensity: "lambdaPerSecond * sharedLiquidityRatio",
    severityDistribution: "exponential",
    severityMean: config.meanSiblingFill,
    executionRule: "Aqua capacity survives when aggregate sibling demand <= realInventory - q",
    firmAdmissionRule: "q <= realInventory and q <= bondPool * (1 - bondUtilization)",
    hardReservationRule: "q is removed from sibling-available inventory for the full TTL",
    limitation: "Synthetic stress model; results are not observed Aqua failure rates or actuarial claims",
  },
  config,
  declaredConfigurations: results.length,
  simulatedEpisodes: results.length * config.episodes,
  gasEvidence: {
    chainId: forkEvidence.chainId,
    forkBlock: forkEvidence.forkBlock,
    officialAqua: forkEvidence.officialContracts.aqua,
    aquaExecutionTransactionHash: forkEvidence.aquaPath.executionTransactionHash,
    bondExecutionTransactionHash: forkEvidence.bondPath.executionTransactionHash,
    ...gas,
    hardReservation: null,
  },
  results,
};

const outputDirectory = new URL("../results/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const rawJson = `${JSON.stringify(rawData, null, 2)}\n`;
await writeFile(new URL("raw.json", outputDirectory), rawJson, "utf8");
await writeFile(new URL("raw.csv", outputDirectory), resultCsv(results), "utf8");
await writeFile(new URL("capital-certainty-frontier.csv", outputDirectory), frontierCsv(results), "utf8");

const admittedResults = results.filter(({ firmDepth }) => firmDepth.admitted > 0);
const adversarial = admittedResults.reduce((worst, current) =>
  current.soft.availabilityLossRate > worst.soft.availabilityLossRate ? current : worst
);
const adversarialReceipt = {
  schemaVersion: "1",
  rawDataSha256: createHash("sha256").update(rawJson).digest("hex"),
  selectionRule: "highest modeled Soft availability-loss rate among configurations admitting Firm",
  scenario: {
    seed: adversarial.seed,
    episodes: adversarial.episodes,
    q: adversarial.q,
    qFraction: adversarial.qFraction,
    ttl: adversarial.ttl,
    sharedLiquidityRatio: adversarial.sharedLiquidityRatio,
    bondUtilization: adversarial.bondUtilization,
  },
  observedCounts: {
    softEligibleAtT0: adversarial.soft.eligibleAtT0,
    softAvailabilityLoss: adversarial.soft.availabilityLoss,
    firmFilledAqua: adversarial.firmDepth.filledAqua,
    firmFilledBond: adversarial.firmDepth.filledBond,
    firmProtectedSettlements: adversarial.firmDepth.protectedSettlements,
  },
  observedRates: {
    softAvailabilityLoss: adversarial.soft.availabilityLossRate,
    firmProtectedSettlementAccepted: adversarial.firmDepth.protectedSettlementAcceptedRate,
    softCapitalReuse: adversarial.soft.capitalReuseRate,
    hardReservationCapitalReuse: adversarial.hardReservation.capitalReuseRate,
    firmCapitalReuse: adversarial.firmDepth.capitalReuseRate,
  },
  forkReplay: {
    chainId: forkEvidence.chainId,
    forkBlock: forkEvidence.forkBlock,
    officialAqua: forkEvidence.officialContracts.aqua,
    aquaExecutionTransactionHash: forkEvidence.aquaPath.executionTransactionHash,
    bondExecutionTransactionHash: forkEvidence.bondPath.executionTransactionHash,
  },
  interpretation: "Synthetic stress output only; no dollar loss or real-network failure frequency is inferred",
};
await writeFile(
  new URL("adversarial-receipt.json", outputDirectory),
  `${JSON.stringify(adversarialReceipt, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({
  seed: config.seed,
  declaredConfigurations: results.length,
  episodesPerConfiguration: config.episodes,
  simulatedEpisodes: results.length * config.episodes,
  rawDataSha256: adversarialReceipt.rawDataSha256,
  outputDirectory: "results",
}, null, 2));

function resultCsv(entries: typeof results): string {
  const header = [
    "seed", "episodes", "q", "q_fraction", "ttl", "slr", "bond_utilization",
    "soft_filled", "soft_availability_loss", "soft_availability_loss_rate",
    "hard_filled", "hard_capital_seconds", "hard_capital_reuse_rate",
    "firm_admitted", "firm_admission_rejected", "firm_filled_aqua", "firm_filled_bond",
    "firm_protected_settlement_attempted_rate", "firm_protected_settlement_accepted_rate",
    "firm_collateral_seconds", "firm_capital_reuse_rate", "expected_firm_gas_per_accepted",
  ];
  const rows = entries.map((entry) => [
    entry.seed,
    entry.episodes,
    entry.q,
    entry.qFraction,
    entry.ttl,
    entry.sharedLiquidityRatio,
    entry.bondUtilization,
    entry.soft.filled,
    entry.soft.availabilityLoss,
    entry.soft.availabilityLossRate,
    entry.hardReservation.filled,
    entry.hardReservation.capitalSeconds,
    entry.hardReservation.capitalReuseRate,
    entry.firmDepth.admitted,
    entry.firmDepth.admissionRejected,
    entry.firmDepth.filledAqua,
    entry.firmDepth.filledBond,
    entry.firmDepth.protectedSettlementAttemptedRate,
    entry.firmDepth.protectedSettlementAcceptedRate,
    entry.firmDepth.collateralSeconds,
    entry.firmDepth.capitalReuseRate,
    entry.gas.expectedFirmGasPerAccepted ?? "",
  ]);
  return csv(header, rows);
}

function frontierCsv(entries: Array<ScenarioResult>): string {
  const header = [
    "seed", "q_fraction", "ttl", "slr", "bond_utilization", "system",
    "protected_execution_rate", "normalized_lock_cost", "capital_reuse_rate",
  ];
  const rows: Array<Array<number | string>> = [];
  for (const entry of entries) {
    const prefix = [entry.seed, entry.qFraction, entry.ttl, entry.sharedLiquidityRatio, entry.bondUtilization];
    rows.push([...prefix, "soft_aqua", 0, entry.soft.normalizedLockCost, entry.soft.capitalReuseRate]);
    rows.push([
      ...prefix,
      "hard_reservation",
      entry.hardReservation.protectedSettlementRate,
      entry.hardReservation.normalizedLockCost,
      entry.hardReservation.capitalReuseRate,
    ]);
    rows.push([
      ...prefix,
      "firmdepth",
      entry.firmDepth.protectedSettlementAttemptedRate,
      entry.firmDepth.normalizedLockCost,
      entry.firmDepth.capitalReuseRate,
    ]);
  }
  return csv(header, rows);
}

function csv(header: string[], rows: Array<Array<number | string>>): string {
  return `${[header, ...rows].map((row) => row.join(",")).join("\n")}\n`;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface BenchmarkConfig {
  schemaVersion: string;
  seed: number;
  episodes: number;
  realInventory: number;
  strategyCount: number;
  ttls: number[];
  arrivalModel: "compound_poisson";
  lambdaPerSecond: number;
  qFractions: number[];
  sharedLiquidityRatios: number[];
  bondUtilizations: number[];
  bondPool: number;
  meanSiblingFill: number;
  gasEvidence: string;
}

export interface Scenario {
  q: number;
  qFraction: number;
  ttl: number;
  sharedLiquidityRatio: number;
  bondUtilization: number;
}

export interface ScenarioResult extends Scenario {
  seed: number;
  episodes: number;
  totalSiblingDemand: number;
  soft: {
    eligibleAtT0: number;
    filled: number;
    availabilityLoss: number;
    availabilityLossRate: number;
    siblingDemandServed: number;
    capitalReuseRate: number;
    protectedSettlementRate: number;
    normalizedLockCost: number;
  };
  hardReservation: {
    admitted: number;
    filled: number;
    siblingDemandServed: number;
    capitalReuseRate: number;
    protectedSettlementRate: number;
    capitalSeconds: number;
    normalizedLockCost: number;
  };
  firmDepth: {
    admitted: number;
    admissionRejected: number;
    filledAqua: number;
    filledBond: number;
    protectedSettlements: number;
    admittedRate: number;
    filledAquaAttemptedRate: number;
    filledBondAttemptedRate: number;
    protectedSettlementAttemptedRate: number;
    protectedSettlementAcceptedRate: number;
    siblingDemandServed: number;
    capitalReuseRate: number;
    collateralSeconds: number;
    normalizedLockCost: number;
  };
}

export function validateConfig(config: BenchmarkConfig): void {
  if (!Number.isSafeInteger(config.seed)) throw new Error("seed must be a safe integer");
  if (!Number.isSafeInteger(config.episodes) || config.episodes < 10_000) {
    throw new Error("episodes must be an integer of at least 10,000");
  }
  positive(config.realInventory, "realInventory");
  positive(config.bondPool, "bondPool");
  positive(config.meanSiblingFill, "meanSiblingFill");
  if (!Number.isInteger(config.strategyCount) || config.strategyCount < 2) {
    throw new Error("strategyCount must be an integer of at least two");
  }
  if (config.arrivalModel !== "compound_poisson") throw new Error("unsupported arrival model");
  if (!Number.isFinite(config.lambdaPerSecond) || config.lambdaPerSecond < 0) {
    throw new Error("lambdaPerSecond must be non-negative");
  }
  for (const ttl of config.ttls) positiveInteger(ttl, "ttl");
  for (const q of config.qFractions) fraction(q, "qFraction", false);
  for (const slr of config.sharedLiquidityRatios) {
    if (!Number.isFinite(slr) || slr < 1) throw new Error("sharedLiquidityRatio must be at least one");
  }
  for (const utilization of config.bondUtilizations) fraction(utilization, "bondUtilization", true);
}

export function scenarios(config: BenchmarkConfig): Scenario[] {
  validateConfig(config);
  const expanded: Scenario[] = [];
  for (const qFraction of config.qFractions) {
    for (const ttl of config.ttls) {
      for (const sharedLiquidityRatio of config.sharedLiquidityRatios) {
        for (const bondUtilization of config.bondUtilizations) {
          expanded.push({
            q: config.realInventory * qFraction,
            qFraction,
            ttl,
            sharedLiquidityRatio,
            bondUtilization,
          });
        }
      }
    }
  }
  return expanded;
}

export function simulateScenario(
  config: BenchmarkConfig,
  scenario: Scenario,
  scenarioIndex: number,
): ScenarioResult {
  validateConfig(config);
  const seed = deriveSeed(config.seed, scenarioIndex);
  const random = mulberry32(seed);
  const initiallyEligible = scenario.q <= config.realInventory;
  const bondAvailable = config.bondPool * (1 - scenario.bondUtilization);
  const firmEligible = initiallyEligible && scenario.q <= bondAvailable;
  const arrivalsMean = config.lambdaPerSecond * scenario.sharedLiquidityRatio * scenario.ttl;

  let totalSiblingDemand = 0;
  let softFilled = 0;
  let firmAqua = 0;
  let firmBond = 0;
  let sharedSiblingServed = 0;
  let reservedSiblingServed = 0;

  for (let episode = 0; episode < config.episodes; episode += 1) {
    const arrivals = poisson(random, arrivalsMean);
    let demand = 0;
    for (let arrival = 0; arrival < arrivals; arrival += 1) {
      demand += exponential(random, config.meanSiblingFill);
    }
    totalSiblingDemand += demand;
    sharedSiblingServed += Math.min(demand, config.realInventory);
    reservedSiblingServed += Math.min(demand, Math.max(0, config.realInventory - scenario.q));

    const aquaCapacitySurvives = demand <= config.realInventory - scenario.q;
    if (initiallyEligible && aquaCapacitySurvives) softFilled += 1;
    if (firmEligible) {
      if (aquaCapacitySurvives) firmAqua += 1;
      else firmBond += 1;
    }
  }

  const episodes = config.episodes;
  const softEligible = initiallyEligible ? episodes : 0;
  const hardAdmitted = initiallyEligible ? episodes : 0;
  const firmAdmitted = firmEligible ? episodes : 0;
  const firmRejected = episodes - firmAdmitted;
  const softLoss = softEligible - softFilled;
  const demandDenominator = totalSiblingDemand === 0 ? 1 : totalSiblingDemand;
  const hardCapitalSeconds = hardAdmitted * scenario.q * scenario.ttl;
  const firmCollateralSeconds = firmAdmitted * scenario.q * scenario.ttl;
  const normalizedDenominator = episodes * config.realInventory * scenario.ttl;

  return {
    ...scenario,
    seed,
    episodes,
    totalSiblingDemand,
    soft: {
      eligibleAtT0: softEligible,
      filled: softFilled,
      availabilityLoss: softLoss,
      availabilityLossRate: rate(softLoss, softEligible),
      siblingDemandServed: sharedSiblingServed,
      capitalReuseRate: sharedSiblingServed / demandDenominator,
      protectedSettlementRate: 0,
      normalizedLockCost: 0,
    },
    hardReservation: {
      admitted: hardAdmitted,
      filled: hardAdmitted,
      siblingDemandServed: reservedSiblingServed,
      capitalReuseRate: reservedSiblingServed / demandDenominator,
      protectedSettlementRate: rate(hardAdmitted, episodes),
      capitalSeconds: hardCapitalSeconds,
      normalizedLockCost: hardCapitalSeconds / normalizedDenominator,
    },
    firmDepth: {
      admitted: firmAdmitted,
      admissionRejected: firmRejected,
      filledAqua: firmAqua,
      filledBond: firmBond,
      protectedSettlements: firmAqua + firmBond,
      admittedRate: rate(firmAdmitted, episodes),
      filledAquaAttemptedRate: rate(firmAqua, episodes),
      filledBondAttemptedRate: rate(firmBond, episodes),
      protectedSettlementAttemptedRate: rate(firmAqua + firmBond, episodes),
      protectedSettlementAcceptedRate: rate(firmAqua + firmBond, firmAdmitted),
      siblingDemandServed: sharedSiblingServed,
      capitalReuseRate: sharedSiblingServed / demandDenominator,
      collateralSeconds: firmCollateralSeconds,
      normalizedLockCost: firmCollateralSeconds / normalizedDenominator,
    },
  };
}

function poisson(random: () => number, mean: number): number {
  if (mean === 0) return 0;
  const limit = Math.exp(-mean);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= random();
  } while (product > limit);
  return count - 1;
}

function exponential(random: () => number, mean: number): number {
  return -Math.log(1 - random()) * mean;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function deriveSeed(seed: number, index: number): number {
  return (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
}

function fraction(value: number, label: string, allowZero: boolean): void {
  const lowerValid = allowZero ? value >= 0 : value > 0;
  if (!Number.isFinite(value) || !lowerValid || value > 1) {
    throw new Error(`${label} must be ${allowZero ? "between zero and one" : "greater than zero and at most one"}`);
  }
}

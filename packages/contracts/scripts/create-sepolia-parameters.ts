import { mkdir, writeFile } from "node:fs/promises";
import { getAddress, Wallet, ZeroAddress } from "ethers";

const parameters = {
  FirmDepth: {
    aqua: requiredAddress("AQUA_ADDRESS"),
    weth: requiredAddress("WETH_ADDRESS"),
    usdc: requiredAddress("USDC_ADDRESS"),
    owner: deployerAddress(),
    minimumPremiumBps: requiredInteger("MINIMUM_PREMIUM_BPS", 0, 10_000),
    maximumPremiumBps: requiredInteger("MAXIMUM_PREMIUM_BPS", 0, 10_000),
    maxQuoteTtl: requiredInteger("MAX_QUOTE_TTL", 1, 86_400),
  },
};

if (parameters.FirmDepth.minimumPremiumBps > parameters.FirmDepth.maximumPremiumBps) {
  throw new Error("MINIMUM_PREMIUM_BPS cannot exceed MAXIMUM_PREMIUM_BPS");
}

await mkdir("ignition/parameters", { recursive: true });
const outputPath = "ignition/parameters/chain-11155111.json";
await writeFile(outputPath, `${JSON.stringify(parameters, null, 2)}\n`, { mode: 0o600 });
console.log(`Wrote validated Sepolia parameters to ${outputPath}`);

function requiredAddress(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  const address = getAddress(value);
  if (address === ZeroAddress) throw new Error(`${name} cannot be the zero address`);
  return address;
}

function requiredInteger(name: string, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function deployerAddress(): string {
  const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
  if (privateKey === undefined || privateKey.length === 0) throw new Error("SEPOLIA_PRIVATE_KEY is required");
  return new Wallet(privateKey).address;
}

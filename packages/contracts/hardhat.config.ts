import { configVariable, defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatIgnition from "@nomicfoundation/hardhat-ignition";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

const compiler = {
  version: "0.8.30",
  settings: {
    optimizer: { enabled: true, runs: 700 },
    viaIR: true,
  },
  isolated: true,
};

const sepoliaForkBlock = process.env.SEPOLIA_FORK_BLOCK;
const parsedSepoliaForkBlock = sepoliaForkBlock === undefined ? undefined : Number(sepoliaForkBlock);
if (parsedSepoliaForkBlock !== undefined && !Number.isSafeInteger(parsedSepoliaForkBlock)) {
  throw new Error("SEPOLIA_FORK_BLOCK must be a safe integer");
}
const baseForkBlock = Number(process.env.BASE_FORK_BLOCK ?? 51_123_118);
if (!Number.isSafeInteger(baseForkBlock) || baseForkBlock <= 0) {
  throw new Error("BASE_FORK_BLOCK must be a positive safe integer");
}

export default defineConfig({
  plugins: [hardhatEthers, hardhatIgnition, hardhatNodeTestRunner, hardhatVerify],
  chainDescriptors: {
    8453: {
      name: "Base",
      chainType: "op",
      hardforkHistory: {
        isthmus: { blockNumber: 0 },
      },
    },
  },
  solidity: {
    splitTestsCompilation: true,
    profiles: {
      default: { compilers: [compiler] },
      production: { compilers: [compiler] },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
  },
  networks: {
    baseFork: {
      type: "edr-simulated",
      chainType: "op",
      chainId: 8453,
      throwOnTransactionFailures: false,
      forking: {
        url: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
        blockNumber: baseForkBlock,
      },
    },
    sepoliaFork: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
      forking: {
        url: configVariable("SEPOLIA_RPC_URL"),
        ...(parsedSepoliaForkBlock === undefined ? {} : { blockNumber: parsedSepoliaForkBlock }),
      },
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      chainId: 11155111,
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: process.env.SEPOLIA_PRIVATE_KEY ? [process.env.SEPOLIA_PRIVATE_KEY] : [],
    },
  },
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
  test: {
    solidity: {
      fuzz: { runs: 1_024 },
    },
  },
});

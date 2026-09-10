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

export default defineConfig({
  plugins: [hardhatEthers, hardhatIgnition, hardhatNodeTestRunner, hardhatVerify],
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

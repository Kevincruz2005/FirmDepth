import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";

const compiler = {
  version: "0.8.30",
  settings: {
    optimizer: { enabled: true, runs: 700 },
    viaIR: true,
  },
  isolated: true,
};

export default defineConfig({
  plugins: [hardhatEthers, hardhatNodeTestRunner],
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
  test: {
    solidity: {
      fuzz: { runs: 256 },
    },
  },
});

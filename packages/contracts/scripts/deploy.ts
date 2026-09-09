import { mkdir, writeFile } from "node:fs/promises";
import { network } from "hardhat";

const { ethers, networkName } = await network.create();
const [owner] = await ethers.getSigners();
if (owner === undefined) throw new Error("No deployer account is available");

const ownerAddress = await owner.getAddress();
const weth = await ethers.deployContract("MockERC20", ["Wrapped Ether", "WETH", 18]);
const usdc = await ethers.deployContract("MockERC20", ["USD Coin", "USDC", 6]);
const aqua = await ethers.deployContract("OfficialAqua");
await Promise.all([weth.waitForDeployment(), usdc.waitForDeployment(), aqua.waitForDeployment()]);

const vault = await ethers.deployContract("BondVault", [await usdc.getAddress(), ownerAddress]);
await vault.waitForDeployment();
const registry = await ethers.deployContract("FirmCommitmentRegistry", [
  await vault.getAddress(),
  await weth.getAddress(),
  await usdc.getAddress(),
  ownerAddress,
  20,
  100,
  120,
]);
await registry.waitForDeployment();
const router = await ethers.deployContract("FirmAquaSwapVMRouter", [
  await aqua.getAddress(),
  await weth.getAddress(),
  ownerAddress,
  await registry.getAddress(),
  await vault.getAddress(),
]);
await router.waitForDeployment();
const executor = await ethers.deployContract("FirmExecutor", [
  await registry.getAddress(),
  await aqua.getAddress(),
  await router.getAddress(),
]);
await executor.waitForDeployment();

await (await vault.setRegistry(await registry.getAddress())).wait();
await (await registry.setExecutor(await executor.getAddress())).wait();

const chain = await ethers.provider.getNetwork();
const artifact = {
  schemaVersion: "1",
  chainId: Number(chain.chainId),
  networkName,
  createdAt: new Date().toISOString(),
  sourceRevisions: {
    aqua: "9c5c42e5840e8741fba3597c48456c9510212b66",
    swapVM: "f09a41e689240adc645934f965c8061749397cd2",
    aquaSDK: "715b12b311193d6091f4bdb5f294db69a9e14596",
  },
  addresses: {
    aqua: await aqua.getAddress(),
    weth: await weth.getAddress(),
    usdc: await usdc.getAddress(),
    bondVault: await vault.getAddress(),
    registry: await registry.getAddress(),
    firmRouter: await router.getAddress(),
    executor: await executor.getAddress(),
  },
  opcodeConfiguration: {
    firmPrice: 0x52,
    firmGuard: 0x21,
    program: "0x52002100",
  },
};

await mkdir("deployments", { recursive: true });
const outputPath = `deployments/firmdepth-${artifact.chainId}.local.json`;
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, ...artifact }, null, 2));

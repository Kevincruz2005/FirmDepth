import { network } from "hardhat";
import type {} from "@nomicfoundation/hardhat-ethers";

const { ethers } = await network.create();
const chain = await ethers.provider.getNetwork();
if (chain.chainId !== 11155111n) throw new Error(`Expected Sepolia chain 11155111, received ${chain.chainId}`);

const addresses = {
  aqua: requiredAddress("AQUA_ADDRESS"),
  weth: requiredAddress("WETH_ADDRESS"),
  usdc: requiredAddress("USDC_ADDRESS"),
};
const makerKey = process.env.MAKER_PRIVATE_KEY;
if (!makerKey || !/^0x[0-9a-fA-F]{64}$/.test(makerKey)) throw new Error("MAKER_PRIVATE_KEY is required for funding and transfer compatibility checks");
const makerAddress = new ethers.Wallet(makerKey).address;
const deployerKey = process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY;
if (!deployerKey || !/^0x[0-9a-fA-F]{64}$/.test(deployerKey)) throw new Error("SEPOLIA_DEPLOYER_PRIVATE_KEY is required for deployment funding checks");
const deployerAddress = new ethers.Wallet(deployerKey).address;
if (deployerAddress === makerAddress) throw new Error("Maker and deployer roles must use distinct addresses");
const firmVirtual = units("FIRM_VIRTUAL_USDC", "5", 6);
const softVirtual = units("SOFT_VIRTUAL_USDC", "5", 6);
const bondTarget = units("BOND_USDC", "18", 6);
const makerUsdcRequired = (firmVirtual > softVirtual ? firmVirtual : softVirtual) + bondTarget;

const bytecode: Record<string, { bytes: number; hash: string }> = {};
for (const [name, address] of Object.entries(addresses)) {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") throw new Error(`${name} has no bytecode at ${address}`);
  bytecode[name] = { bytes: (code.length - 2) / 2, hash: ethers.keccak256(code) };
}

const erc20 = ["function decimals() view returns (uint8)", "function symbol() view returns (string)", "function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"];
const weth = new ethers.Contract(addresses.weth, erc20, ethers.provider);
const usdc = new ethers.Contract(addresses.usdc, erc20, ethers.provider);
const aqua = new ethers.Contract(
  addresses.aqua,
  ["function rawBalances(address,address,bytes32,address) view returns (uint248,uint8)"],
  ethers.provider,
);
const [[wethSymbol, wethDecimals], [usdcSymbol, usdcDecimals], rawBalance, deployerEth, makerEth, makerWeth, makerUsdc] = await Promise.all([
  Promise.all([weth.symbol(), weth.decimals()]),
  Promise.all([usdc.symbol(), usdc.decimals()]),
  aqua.rawBalances(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroHash, ethers.ZeroAddress),
  ethers.provider.getBalance(deployerAddress),
  ethers.provider.getBalance(makerAddress),
  weth.balanceOf(makerAddress),
  usdc.balanceOf(makerAddress),
]);
if (wethSymbol !== "WETH" || wethDecimals !== 18n) throw new Error("Configured WETH metadata is unexpected");
if (usdcSymbol !== "USDC" || usdcDecimals !== 6n) throw new Error("Configured USDC metadata is unexpected");
if (rawBalance[0] !== 0n || rawBalance[1] !== 0n) throw new Error("Aqua rawBalances compatibility probe failed");
if (!(await weth.transfer.staticCall(makerAddress, 0n, { from: makerAddress }))) throw new Error("WETH transfer compatibility probe failed");
if (!(await usdc.transfer.staticCall(makerAddress, 0n, { from: makerAddress }))) throw new Error("USDC transfer compatibility probe failed");
if (deployerEth === 0n) throw new Error("Deployer has no Sepolia ETH for deployment transactions");
if (makerEth === 0n) throw new Error("Maker has no Sepolia ETH for setup transactions");
if (makerUsdc < makerUsdcRequired) throw new Error(`Maker requires at least ${ethers.formatUnits(makerUsdcRequired, 6)} Circle Sepolia USDC for configured inventory and Bond; observed ${ethers.formatUnits(makerUsdc, 6)}`);

console.log(JSON.stringify({
  chainId: Number(chain.chainId),
  blockNumber: await ethers.provider.getBlockNumber(),
  addresses,
  bytecode,
  tokenMetadata: {
    weth: { symbol: wethSymbol, decimals: Number(wethDecimals) },
    usdc: { symbol: usdcSymbol, decimals: Number(usdcDecimals) },
  },
  aquaRawBalancesCompatible: true,
  transferCompatible: true,
  deployerFunding: { address: deployerAddress, eth: deployerEth.toString() },
  makerFunding: {
    address: makerAddress,
    eth: makerEth.toString(),
    weth: makerWeth.toString(),
    usdc: makerUsdc.toString(),
    minimumUsdcRequired: makerUsdcRequired.toString(),
  },
}, null, 2));

function requiredAddress(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return ethers.getAddress(value);
}

function units(name: string, fallback: string, decimals: number): bigint {
  const value = process.env[name] ?? fallback;
  const parsed = ethers.parseUnits(value, decimals);
  if (parsed <= 0n) throw new Error(`${name} must be positive`);
  return parsed;
}

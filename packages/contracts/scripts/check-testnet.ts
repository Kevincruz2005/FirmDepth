import { network } from "hardhat";

const { ethers } = await network.create();
const chain = await ethers.provider.getNetwork();
if (chain.chainId !== 11155111n) throw new Error(`Expected Sepolia chain 11155111, received ${chain.chainId}`);

const addresses = {
  aqua: requiredAddress("AQUA_ADDRESS"),
  weth: requiredAddress("WETH_ADDRESS"),
  usdc: requiredAddress("USDC_ADDRESS"),
};

for (const [name, address] of Object.entries(addresses)) {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") throw new Error(`${name} has no bytecode at ${address}`);
}

const erc20 = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];
const weth = new ethers.Contract(addresses.weth, erc20, ethers.provider);
const usdc = new ethers.Contract(addresses.usdc, erc20, ethers.provider);
const aqua = new ethers.Contract(
  addresses.aqua,
  ["function rawBalances(address,address,bytes32,address) view returns (uint248,uint8)"],
  ethers.provider,
);
const [[wethSymbol, wethDecimals], [usdcSymbol, usdcDecimals], rawBalance] = await Promise.all([
  Promise.all([weth.symbol(), weth.decimals()]),
  Promise.all([usdc.symbol(), usdc.decimals()]),
  aqua.rawBalances(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroHash, ethers.ZeroAddress),
]);
if (wethSymbol !== "WETH" || wethDecimals !== 18n) throw new Error("Configured WETH metadata is unexpected");
if (usdcSymbol !== "USDC" || usdcDecimals !== 6n) throw new Error("Configured USDC metadata is unexpected");
if (rawBalance[0] !== 0n || rawBalance[1] !== 0n) throw new Error("Aqua rawBalances compatibility probe failed");

console.log(JSON.stringify({
  chainId: Number(chain.chainId),
  blockNumber: await ethers.provider.getBlockNumber(),
  addresses,
  tokenMetadata: {
    weth: { symbol: wethSymbol, decimals: Number(wethDecimals) },
    usdc: { symbol: usdcSymbol, decimals: Number(usdcDecimals) },
  },
  aquaRawBalancesCompatible: true,
}, null, 2));

function requiredAddress(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return ethers.getAddress(value);
}

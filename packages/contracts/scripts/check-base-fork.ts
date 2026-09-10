import { network } from "hardhat";

const AQUA = "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a";
const SWAP_VM_ROUTER = "0x111111338c5091e8440b67b168bae16a668ac0de";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const { ethers } = await network.create();
const chain = await ethers.provider.getNetwork();
if (chain.chainId !== 8453n) throw new Error(`Expected Base chain 8453, received ${chain.chainId}`);
const forkBlock = await ethers.provider.getBlock("latest");
if (forkBlock === null) throw new Error("Pinned Base fork block is unavailable");

const addresses = { aqua: AQUA, swapVmRouter: SWAP_VM_ROUTER, weth: WETH, usdc: USDC };
const bytecodeBytes: Record<string, number> = {};
for (const [name, address] of Object.entries(addresses)) {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") throw new Error(`${name} has no bytecode at ${address}`);
  bytecodeBytes[name] = (code.length - 2) / 2;
}

const erc20Abi = ["function symbol() view returns (string)", "function decimals() view returns (uint8)"];
const weth = new ethers.Contract(WETH, erc20Abi, ethers.provider);
const usdc = new ethers.Contract(USDC, erc20Abi, ethers.provider);
const aqua = new ethers.Contract(
  AQUA,
  ["function rawBalances(address,address,bytes32,address) view returns (uint248,uint8)"],
  ethers.provider,
);

const [[wethSymbol, wethDecimals], [usdcSymbol, usdcDecimals], emptyBalance] = await Promise.all([
  Promise.all([weth.symbol(), weth.decimals()]),
  Promise.all([usdc.symbol(), usdc.decimals()]),
  aqua.rawBalances(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroHash, ethers.ZeroAddress),
]);
if (wethSymbol !== "WETH" || wethDecimals !== 18n) throw new Error("Base WETH metadata mismatch");
if (usdcSymbol !== "USDC" || usdcDecimals !== 6n) throw new Error("Base USDC metadata mismatch");
if (emptyBalance[0] !== 0n || emptyBalance[1] !== 0n) throw new Error("Official Aqua compatibility probe failed");

console.log(JSON.stringify({
  chainId: Number(chain.chainId),
  blockNumber: forkBlock.number,
  blockTimestamp: forkBlock.timestamp,
  blockHash: forkBlock.hash,
  addresses,
  bytecodeBytes,
  tokenMetadata: {
    weth: { symbol: wethSymbol, decimals: Number(wethDecimals) },
    usdc: { symbol: usdcSymbol, decimals: Number(usdcDecimals) },
  },
  aquaRawBalancesCompatible: true,
}, null, 2));

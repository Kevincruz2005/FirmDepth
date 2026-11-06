import {readFile,writeFile} from "node:fs/promises";
import {network} from "hardhat";
import {BASE_AAVE_POOL,BASE_AAVE_USDC_DEBT,AAVE_POOL_ABI,AAVE_DEBT_ABI,verifyAaveBase} from "./lib/aave-base.ts";
// Reuse the canonical fork holder rather than scanning remote historical logs.
process.env.FIRMDEPTH_FORK_HOLDER ??= "0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59";
const {ethers}=await network.create();
const metadata=await ethers.provider.send("hardhat_metadata",[]);
if(metadata.forkedNetwork?.forkBlockNumber!==51123118)throw Error("Debt setup requires the canonical local Base fork");
await import("./setup-protected-fork.ts");
const runtimePath="../frontend/.runtime/firmdepth.json";
const runtime=JSON.parse(await readFile(runtimePath,"utf8"));
const compatibility=await verifyAaveBase(ethers.provider,runtime.addresses.usdc);
const [,maker,borrower]=await ethers.getSigners();
const borrowerAddress=await borrower.getAddress();
const weth=new ethers.Contract(runtime.addresses.weth,["function approve(address,uint256) returns(bool)"],borrower);
const pool=new ethers.Contract(BASE_AAVE_POOL,AAVE_POOL_ABI,borrower);
const debt=new ethers.Contract(BASE_AAVE_USDC_DEBT,AAVE_DEBT_ABI,ethers.provider);
const usdc=new ethers.Contract(runtime.addresses.usdc,["function balanceOf(address) view returns(uint256)","function approve(address,uint256) returns(bool)","function transfer(address,uint256) returns(bool)"],borrower);
// A previous fixture's debt includes interest, while borrowing credits principal
// only. Fund that interest with a real maker transfer, never a storage edit.
const interestFunding=await(await usdc.connect(maker).transfer(borrowerAddress,1_000_000n)).wait();
await (await weth.approve(BASE_AAVE_POOL,ethers.parseEther("1"))).wait();
const supplied=await (await pool.supply(runtime.addresses.weth,ethers.parseEther("1"),borrowerAddress,0)).wait();
// Repeated browser fixtures close earlier test debt through real Pool.repay.
// No debt balance, token storage, Aave code, oracle, or reserve is overwritten.
let cleanupRepaymentTransactionHash:string|undefined;
const earlierDebt=await debt.balanceOf(borrowerAddress);
if(earlierDebt>0n){
 const available=await usdc.balanceOf(borrowerAddress);
 const amount=available<earlierDebt+1000n?available:earlierDebt+1000n;
 if(amount<earlierDebt)throw Error("Test borrower lacks real USDC to close the previous fixture debt");
 await(await usdc.approve(BASE_AAVE_POOL,amount)).wait();
 const cleaned=await(await pool.repay(runtime.addresses.usdc,amount,2,borrowerAddress)).wait();
 if(cleaned.status!==1||await debt.scaledBalanceOf(borrowerAddress)!==0n)throw Error("Prior Aave fixture debt was not fully repaid");
 cleanupRepaymentTransactionHash=cleaned.hash;
}
const borrowReceipt=await (await pool.borrow(runtime.addresses.usdc,600_000_000n,2,0,borrowerAddress)).wait();
if(borrowReceipt.status!==1)throw Error("Actual Aave borrowing transaction failed");
const balance=await debt.balanceOf(borrowerAddress);
if(balance<600_000_000n)throw Error("Actual Aave variable debt was not created");
const adapter=await ethers.deployContract("ProtectedDebtRepayment",[runtime.settlement.address,BASE_AAVE_POOL,BASE_AAVE_USDC_DEBT,8453]);
await adapter.waitForDeployment();
const deployed=await adapter.deploymentTransaction()!.wait();
runtime.debtRepayment={address:await adapter.getAddress(),pool:BASE_AAVE_POOL,asset:runtime.addresses.usdc,variableDebtToken:BASE_AAVE_USDC_DEBT,aToken:compatibility.aToken,debtMode:2,deploymentBlock:deployed!.blockNumber,deploymentTransactionHash:deployed!.hash,borrower:borrowerAddress,supplyTransactionHash:supplied.hash,interestFundingTransactionHash:interestFunding.hash,borrowTransactionHash:borrowReceipt.hash,initialDebt:balance.toString(),...(cleanupRepaymentTransactionHash?{cleanupRepaymentTransactionHash}:{})};
await writeFile(runtimePath,JSON.stringify(runtime,null,2)+"\n");
console.log("Real Aave debt position created:",borrowReceipt.hash,"debt:",balance.toString(),"repayment adapter:",runtime.debtRepayment.address);

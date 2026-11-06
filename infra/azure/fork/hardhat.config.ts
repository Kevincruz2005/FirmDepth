import {defineConfig} from "hardhat/config";
import ethers from "@nomicfoundation/hardhat-ethers";
// Deployment-only runtime: use the already-tested compiled artifacts. No remote
// network or real-chain signing account is configured in this application.
export default defineConfig({
 plugins:[ethers],
 chainDescriptors:{8453:{name:"Base",chainType:"op",hardforkHistory:{isthmus:{blockNumber:0}}}},
 networks:{
  debtFork:{type:"edr-simulated",chainType:"op",chainId:8453,initialDate:new Date().toISOString(),forking:{url:process.env.BASE_RPC_URL||"https://mainnet.base.org",blockNumber:51123118}},
  localBase:{type:"http",chainType:"op",chainId:8453,url:process.env.FIRMDEPTH_FORK_RPC_URL||"http://127.0.0.1:8545",accounts:"remote"},
 },
});

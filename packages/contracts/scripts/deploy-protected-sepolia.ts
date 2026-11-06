import {writeFile,readFile} from "node:fs/promises";
import {network} from "hardhat";
import {authenticateFirmDepthDeployment} from "../../sdk/dist/deployment.js";
import {authenticateSettlement} from "../../sdk/dist/settlement.js";
import {createPublicClient,http} from "viem";
if(!/^0x[0-9a-fA-F]{64}$/.test(process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY??""))throw Error("SEPOLIA_DEPLOYER_PRIVATE_KEY must be configured with a funded deployer");
const rpc=process.env.SEPOLIA_RPC_URL;
if(!rpc)throw Error("SEPOLIA_RPC_URL is required");
const {ethers}=await network.create();
if((await ethers.provider.getNetwork()).chainId!==11155111n)throw Error("Public wrapper deployment requires Sepolia");
const manifest=JSON.parse(await readFile("../../deployments/sepolia.json","utf8"));
const client=createPublicClient({transport:http(rpc)});
await authenticateFirmDepthDeployment(client,manifest.addresses);
const [deployer]=await ethers.getSigners();
if(!deployer)throw Error("SEPOLIA_DEPLOYER_PRIVATE_KEY must configure a funded deployer");
if(await ethers.provider.getBalance(await deployer.getAddress())===0n)throw Error("Deployer has no Sepolia ETH");
const output="../../deployments/protected-sepolia.json";
try{
 const existing=JSON.parse(await readFile(output,"utf8"));
 await authenticateSettlement(client,existing.address,manifest.addresses);
 console.log("Existing compatible wrapper verified:",existing.address);
 process.exit(0);
}catch(error){
 if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
}
const wrapper=await ethers.deployContract("ProtectedSettlement",[manifest.addresses.registry,manifest.addresses.executor]);
await wrapper.waitForDeployment();
const receipt=await wrapper.deploymentTransaction()!.wait();
if(!receipt||receipt.status!==1)throw Error("Wrapper deployment failed");
const address=await wrapper.getAddress();
await authenticateSettlement(client,address,manifest.addresses);
await writeFile(output,JSON.stringify({schemaVersion:"1",chainId:11155111,environment:"public-sepolia",address,registry:manifest.addresses.registry,executor:manifest.addresses.executor,deployer:await deployer.getAddress(),transactionHash:receipt.hash,blockNumber:receipt.blockNumber,createdAt:new Date().toISOString()},null,2)+"\n");
console.log("Deployed and verified public Sepolia wrapper:",address,"transaction:",receipt.hash);

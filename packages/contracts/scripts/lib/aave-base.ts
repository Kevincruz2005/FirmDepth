import {ethers} from "ethers";
import {BASE_USDC,BASE_WETH} from "./base-fork.ts";

// Official Aave address book; independently authenticated against fork state.
export const BASE_AAVE_POOL="0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
export const BASE_AAVE_USDC_DEBT="0x59dca05b6c26dbd64b5381374aAaC5CD05644C28";
export const BASE_AAVE_USDC_ATOKEN="0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB";
export const AAVE_POOL_ABI=[
 "function ADDRESSES_PROVIDER() view returns(address)",
 "function getConfiguration(address) view returns(uint256)",
 "function supply(address,uint256,address,uint16)",
 "function borrow(address,uint256,uint256,uint16,address)",
 "function repay(address,uint256,uint256,address) returns(uint256)",
 "function getUserAccountData(address) view returns(uint256,uint256,uint256,uint256,uint256,uint256)",
 "event Repay(address indexed reserve,address indexed user,address indexed repayer,uint256 amount,bool useATokens)",
];
export const AAVE_DEBT_ABI=[
 "function POOL() view returns(address)","function UNDERLYING_ASSET_ADDRESS() view returns(address)",
 "function balanceOf(address) view returns(uint256)","function scaledBalanceOf(address) view returns(uint256)","function decimals() view returns(uint8)",
];
export async function verifyAaveBase(provider:ethers.Provider,asset=BASE_USDC){
 const same=(a:string,b:string)=>ethers.getAddress(a)===ethers.getAddress(b);
 if((await provider.getNetwork()).chainId!==8453n || !same(asset,BASE_USDC))throw Error("Aave repayment requires Base native USDC; Sepolia demo assets are not interchangeable");
 const pool=new ethers.Contract(BASE_AAVE_POOL,AAVE_POOL_ABI,provider);
 const providerAddress=await pool.ADDRESSES_PROVIDER();
 const addressesProvider=new ethers.Contract(providerAddress,["function getPool() view returns(address)","function getPoolDataProvider() view returns(address)"],provider);
 if(!same(await addressesProvider.getPool(),BASE_AAVE_POOL))throw Error("Aave registered Pool mismatch");
 const dataProviderAddress=await addressesProvider.getPoolDataProvider();
 const dataProvider=new ethers.Contract(dataProviderAddress,["function getReserveTokensAddresses(address) view returns(address,address,address)"],provider);
 const [aToken,,variableDebt]=await dataProvider.getReserveTokensAddresses(asset);
 if(!same(aToken,BASE_AAVE_USDC_ATOKEN)||!same(variableDebt,BASE_AAVE_USDC_DEBT))throw Error("Aave USDC reserve token mismatch");
 const debt=new ethers.Contract(variableDebt,AAVE_DEBT_ABI,provider);
 if(!same(await debt.POOL(),BASE_AAVE_POOL)||!same(await debt.UNDERLYING_ASSET_ADDRESS(),asset)||await debt.decimals()!==6n)throw Error("Aave variable debt identity mismatch");
 const configuration=BigInt(await pool.getConfiguration(asset));
 if(((configuration>>56n)&1n)!==1n||((configuration>>60n)&1n)!==0n||((configuration>>48n)&255n)!==6n)throw Error("Aave USDC reserve is inactive, paused or has unexpected decimals");
 const codeHashes:Record<string,string>={};
 for(const [name,address]of Object.entries({pool:BASE_AAVE_POOL,usdc:asset,weth:BASE_WETH,variableDebt,aToken})){
  const code=await provider.getCode(address);if(code==="0x")throw Error(`${name} bytecode missing`);codeHashes[name]=ethers.keccak256(code);
 }
 return {chainId:8453,pool:BASE_AAVE_POOL,asset,variableDebt,aToken,addressesProvider:providerAddress,dataProvider:dataProviderAddress,configuration:configuration.toString(),codeHashes};
}

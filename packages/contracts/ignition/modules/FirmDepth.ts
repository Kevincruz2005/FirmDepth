import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("FirmDepth", (module) => {
  const aqua = module.getParameter("aqua");
  const weth = module.getParameter("weth");
  const usdc = module.getParameter("usdc");
  const owner = module.getParameter("owner");
  const maxQuoteTtl = module.getParameter("maxQuoteTtl");

  const vault = module.contract("BondVault", [usdc, owner]);
  const registry = module.contract("FirmCommitmentRegistry", [
    vault,
    weth,
    usdc,
    owner,
    maxQuoteTtl,
  ]);
  const router = module.contract("FirmAquaSwapVMRouter", [aqua, weth, owner, registry, vault]);
  const executor = module.contract("FirmExecutor", [registry, aqua, router]);

  module.call(vault, "setRegistry", [registry]);
  module.call(registry, "setExecutor", [executor]);

  return { vault, registry, router, executor };
});

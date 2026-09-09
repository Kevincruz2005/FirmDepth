// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { AquaSwapVMRouter } from "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol";
import { Context } from "@1inch/swap-vm/src/libs/VM.sol";

import { BondVault } from "./BondVault.sol";
import { FirmGuard } from "./instructions/FirmGuard.sol";
import { FirmPrice } from "./instructions/FirmPrice.sol";
import { IFirmCommitmentRegistry } from "./types/FirmTypes.sol";

contract FirmAquaSwapVMRouter is AquaSwapVMRouter {
    uint8 public constant FIRM_GUARD_OPCODE = 0x21;
    uint8 public constant FIRM_PRICE_OPCODE = 0x52;

    IFirmCommitmentRegistry public immutable FIRM_REGISTRY;
    BondVault public immutable BOND_VAULT;

    constructor(
        address aqua,
        address weth,
        address owner,
        address firmRegistry,
        address bondVault
    ) AquaSwapVMRouter(aqua, weth, owner, "FirmDepth SwapVM", "1") {
        FIRM_REGISTRY = IFirmCommitmentRegistry(firmRegistry);
        BOND_VAULT = BondVault(bondVault);
    }

    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == FirmPrice.OPCODE) {
            FirmPrice.exec(ctx, args, FIRM_REGISTRY);
        } else if (opcode == FirmGuard.OPCODE) {
            FirmGuard.exec(ctx, args, FIRM_REGISTRY, BOND_VAULT);
        } else {
            super._runOpcode(ctx, opcode, args);
        }
    }
}

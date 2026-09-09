// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";

library FirmPrice {
    using ContextLib for Context;

    uint8 internal constant OPCODE = 0x52;

    error UnexpectedStaticArgs(uint256 length);
    error MissingFirmAmountOut();
    error ExactInputRequired();
    error ZeroFirmAmountOut();

    function exec(Context memory ctx, bytes calldata args) internal pure {
        if (args.length != 0) revert UnexpectedStaticArgs(args.length);
        bytes calldata dynamicArgs = ctx.tryChopTakerArgs(32);
        if (dynamicArgs.length != 32) revert MissingFirmAmountOut();
        if (!ctx.query.isExactIn) revert ExactInputRequired();
        uint256 amountOut = uint256(bytes32(dynamicArgs));
        if (amountOut == 0) revert ZeroFirmAmountOut();
        ctx.swap.amountOut = amountOut;
    }
}

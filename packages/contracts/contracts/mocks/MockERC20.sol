// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _tokenDecimals;
    bool public transferFromReverts;
    bool public transferFromRevertsEmpty;
    bool public transferFromPanics;
    bool public transferSkips;
    address public transferFromCallbackTarget;
    bytes public transferFromCallbackData;

    error ForcedTransferFromRevert();

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _tokenDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTransferFromReverts(bool value) external {
        transferFromReverts = value;
    }

    function setTransferFromRevertsEmpty(bool value) external {
        transferFromRevertsEmpty = value;
    }

    function setTransferFromPanics(bool value) external {
        transferFromPanics = value;
    }

    function setTransferSkips(bool value) external {
        transferSkips = value;
    }

    function setTransferFromCallback(address target, bytes calldata data) external {
        transferFromCallbackTarget = target;
        transferFromCallbackData = data;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (transferSkips) return true;
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (transferFromReverts) revert ForcedTransferFromRevert();
        if (transferFromRevertsEmpty) {
            assembly ("memory-safe") {
                revert(0, 0)
            }
        }
        assert(!transferFromPanics);
        if (transferFromCallbackTarget != address(0)) {
            (bool success, bytes memory reason) = transferFromCallbackTarget.call(transferFromCallbackData);
            if (!success) {
                assembly ("memory-safe") {
                    revert(add(reason, 32), mload(reason))
                }
            }
        }
        return super.transferFrom(from, to, value);
    }
}

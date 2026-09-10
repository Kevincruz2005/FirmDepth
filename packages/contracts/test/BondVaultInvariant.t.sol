// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { BondVault } from "../contracts/BondVault.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";

contract BondVaultInvariantTest is Test {
    MockERC20 private token;
    BondVault private vault;
    address private makerOne;
    address private makerTwo;
    address private beneficiary;

    function setUp() public {
        token = new MockERC20("USD Coin", "USDC", 6);
        vault = new BondVault(address(token), address(this));
        vault.setRegistry(address(this));
        makerOne = makeAddr("maker-one");
        makerTwo = makeAddr("maker-two");
        beneficiary = makeAddr("beneficiary");
    }

    function testFuzzLocksReconcileAcrossMakers(
        uint96 rawFirst,
        uint96 rawSecond,
        uint96 rawFirstPayout
    ) public {
        uint256 first = bound(uint256(rawFirst), 1, 1_000_000e6);
        uint256 second = bound(uint256(rawSecond), 1, 1_000_000e6);
        uint256 firstPayout = bound(uint256(rawFirstPayout), 1, first);
        bytes32 firstId = keccak256("first");
        bytes32 secondId = keccak256("second");

        _deposit(makerOne, first);
        _deposit(makerTwo, second);
        vault.lock(firstId, makerOne, first);
        vault.lock(secondId, makerTwo, second);

        assertEq(vault.totalAvailable(), 0);
        assertEq(vault.totalLocked(), first + second);
        assertEq(vault.lockedOf(makerOne) + vault.lockedOf(makerTwo), vault.totalLocked());
        assertEq(vault.liabilities(), token.balanceOf(address(vault)));

        vault.release(firstId, beneficiary, firstPayout);
        assertEq(token.balanceOf(beneficiary), firstPayout);
        assertEq(vault.availableOf(makerOne), first - firstPayout);
        assertEq(vault.lockedOf(makerTwo), second);
        assertEq(vault.totalLocked(), second);
        assertEq(vault.liabilities(), token.balanceOf(address(vault)));

        vault.unlock(secondId);
        assertEq(vault.totalLocked(), 0);
        assertEq(vault.lockedOf(makerOne) + vault.lockedOf(makerTwo), 0);
        assertEq(vault.liabilities(), token.balanceOf(address(vault)));
    }

    function testConsumedLocksCannotBeReleasedOrUnlockedTwice() public {
        bytes32 commitmentId = keccak256("terminal");
        _deposit(makerOne, 10e6);
        vault.lock(commitmentId, makerOne, 10e6);
        vault.release(commitmentId, beneficiary, 8e6);

        vm.expectRevert(
            abi.encodeWithSelector(BondVault.CommitmentNotLocked.selector, commitmentId)
        );
        vault.release(commitmentId, beneficiary, 1e6);

        vm.expectRevert(
            abi.encodeWithSelector(BondVault.CommitmentNotLocked.selector, commitmentId)
        );
        vault.unlock(commitmentId);

        assertEq(vault.totalLocked(), 0);
        assertEq(vault.availableOf(makerOne), 2e6);
        assertEq(vault.liabilities(), token.balanceOf(address(vault)));
    }

    function _deposit(address maker, uint256 amount) private {
        token.mint(maker, amount);
        vm.startPrank(maker);
        token.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }
}

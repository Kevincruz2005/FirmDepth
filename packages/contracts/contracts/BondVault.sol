// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract BondVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct BondLock {
        address maker;
        uint256 amount;
    }

    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error RegistryAlreadySet();
    error InsufficientAvailable(uint256 available, uint256 required);
    error CommitmentAlreadyLocked(bytes32 commitmentId);
    error CommitmentNotLocked(bytes32 commitmentId);
    error DeflationaryTokenUnsupported();

    IERC20 public immutable bondToken;
    address public immutable owner;
    address public registry;

    mapping(address maker => uint256) public availableOf;
    mapping(address maker => uint256) public lockedOf;
    mapping(bytes32 commitmentId => BondLock) private _locks;

    uint256 public totalAvailable;
    uint256 public totalLocked;

    event RegistrySet(address indexed registry);
    event Deposited(address indexed maker, uint256 amount);
    event Withdrawn(address indexed maker, address indexed to, uint256 amount);
    event BondLocked(bytes32 indexed commitmentId, address indexed maker, uint256 amount);
    event BondUnlocked(bytes32 indexed commitmentId, address indexed maker, uint256 amount);
    event BondReleased(bytes32 indexed commitmentId, address indexed maker, address indexed to, uint256 amount);

    constructor(address bondToken_, address owner_) {
        if (bondToken_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        bondToken = IERC20(bondToken_);
        owner = owner_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyRegistry() {
        if (msg.sender != registry) revert Unauthorized();
        _;
    }

    function setRegistry(address registry_) external onlyOwner {
        if (registry != address(0)) revert RegistryAlreadySet();
        if (registry_ == address(0)) revert ZeroAddress();
        registry = registry_;
        emit RegistrySet(registry_);
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 beforeBalance = bondToken.balanceOf(address(this));
        bondToken.safeTransferFrom(msg.sender, address(this), amount);
        if (bondToken.balanceOf(address(this)) - beforeBalance != amount) revert DeflationaryTokenUnsupported();

        availableOf[msg.sender] += amount;
        totalAvailable += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount, address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 available = availableOf[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (available < amount) revert InsufficientAvailable(available, amount);

        availableOf[msg.sender] = available - amount;
        totalAvailable -= amount;
        bondToken.safeTransfer(to, amount);
        emit Withdrawn(msg.sender, to, amount);
    }

    function lock(bytes32 commitmentId, address maker, uint256 amount) external onlyRegistry {
        if (maker == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (_locks[commitmentId].maker != address(0)) revert CommitmentAlreadyLocked(commitmentId);
        uint256 available = availableOf[maker];
        if (available < amount) revert InsufficientAvailable(available, amount);

        availableOf[maker] = available - amount;
        lockedOf[maker] += amount;
        totalAvailable -= amount;
        totalLocked += amount;
        _locks[commitmentId] = BondLock({ maker: maker, amount: amount });
        emit BondLocked(commitmentId, maker, amount);
    }

    function unlock(bytes32 commitmentId) external onlyRegistry {
        BondLock memory bond = _consumeLock(commitmentId);
        availableOf[bond.maker] += bond.amount;
        totalAvailable += bond.amount;
        emit BondUnlocked(commitmentId, bond.maker, bond.amount);
    }

    function release(bytes32 commitmentId, address to) external onlyRegistry nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        BondLock memory bond = _consumeLock(commitmentId);
        uint256 vaultBefore = bondToken.balanceOf(address(this));
        uint256 recipientBefore = bondToken.balanceOf(to);
        bondToken.safeTransfer(to, bond.amount);
        uint256 vaultAfter = bondToken.balanceOf(address(this));
        uint256 recipientAfter = bondToken.balanceOf(to);
        if (
            vaultBefore < vaultAfter
                || vaultBefore - vaultAfter != bond.amount
                || recipientAfter < recipientBefore
                || recipientAfter - recipientBefore != bond.amount
        ) revert DeflationaryTokenUnsupported();
        emit BondReleased(commitmentId, bond.maker, to, bond.amount);
    }

    function lockedFor(bytes32 commitmentId) external view returns (address maker, uint256 amount) {
        BondLock memory bond = _locks[commitmentId];
        return (bond.maker, bond.amount);
    }

    function liabilities() external view returns (uint256) {
        return totalAvailable + totalLocked;
    }

    function _consumeLock(bytes32 commitmentId) private returns (BondLock memory bond) {
        bond = _locks[commitmentId];
        if (bond.maker == address(0)) revert CommitmentNotLocked(commitmentId);
        delete _locks[commitmentId];
        lockedOf[bond.maker] -= bond.amount;
        totalLocked -= bond.amount;
    }
}

// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { FirmCommitmentRegistry } from "./FirmCommitmentRegistry.sol";
import { FirmExecutor } from "./FirmExecutor.sol";
import { Commitment, CommitmentStatus, FirmQuote } from "./types/FirmTypes.sol";

/// @notice Payer-authorized, atomic distribution of a FirmDepth commitment's output.
/// @dev Standard exact-transfer tokens only. Donations are never credited to plans.
contract ProtectedSettlement is ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum State { NONE, CREATED, FUNDED, ACCEPTED, SETTLED, REFUNDED }
    struct Payout { address recipient; uint256 amount; }
    struct Plan {
        address payer;
        State state;
        uint64 deadline;
        uint256 amountIn;
        uint256 maxPremium;
        uint256 totalOut;
        uint256 escrow;
        uint256 premiumPaid;
        bytes32 commitmentId;
    }
    FirmCommitmentRegistry public immutable registry;
    FirmExecutor public immutable executor;
    IERC20 public immutable tokenIn;
    IERC20 public immutable tokenOut;
    address public immutable router;
    uint256 public totalEscrow;
    uint256 public constant MAX_RECIPIENTS = 32;
    mapping(bytes32 => Plan) private _plans;
    mapping(bytes32 => Payout[]) private _payouts;
    mapping(bytes32 => bytes32) public commitmentPlan;
    error Unauthorized();
    error InvalidPlan();
    error InvalidState();
    error InvalidQuote();
    error InexactTransfer();
    error NotExpired();
    event PlanCreated(bytes32 indexed planId, address indexed payer, uint256 nonce, uint256 amountIn, uint256 maxPremium, uint64 deadline, uint256 totalOut);
    event Allocation(bytes32 indexed planId, uint256 indexed index, address indexed recipient, uint256 amount);
    event PlanFunded(bytes32 indexed planId, uint256 amount);
    event PlanAccepted(bytes32 indexed planId, bytes32 indexed commitmentId, uint256 premium);
    event RecipientPaid(bytes32 indexed planId, uint256 indexed index, address indexed recipient, uint256 amount);
    event PlanSettled(bytes32 indexed planId, bytes32 indexed commitmentId, CommitmentStatus status, uint256 proceeds, uint256 surplus, uint256 refund);
    event PlanRefunded(bytes32 indexed planId, address indexed payer, uint256 amount);

    constructor(address registry_, address executor_) {
        registry = FirmCommitmentRegistry(registry_);
        executor = FirmExecutor(executor_);
        if (registry.executor() != executor_ || address(executor.registry()) != registry_) revert InvalidPlan();
        tokenIn = IERC20(registry.tokenIn());
        tokenOut = IERC20(registry.tokenOut());
        router = address(executor.router());
        if (address(tokenIn) == address(tokenOut) || address(registry.vault().bondToken()) != address(tokenOut)) revert InvalidPlan();
    }

    function planIdFor(address payer, uint256 nonce) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), payer, nonce));
    }
    function getPlan(bytes32 id) external view returns (Plan memory) { return _plans[id]; }
    function getPayouts(bytes32 id) external view returns (Payout[] memory) { return _payouts[id]; }

    function createPlan(uint256 nonce, uint256 amountIn, uint256 maxPremium, uint64 deadline, Payout[] calldata payouts)
        external nonReentrant returns (bytes32 id)
    {
        id = planIdFor(msg.sender, nonce);
        if (_plans[id].state != State.NONE || amountIn == 0 || deadline <= block.timestamp || payouts.length == 0 || payouts.length > MAX_RECIPIENTS) revert InvalidPlan();
        uint256 total;
        for (uint256 i; i < payouts.length; ++i) {
            Payout calldata p = payouts[i];
            if (p.recipient == address(0) || p.recipient == address(this) || p.amount == 0) revert InvalidPlan();
            for (uint256 j; j < i; ++j) if (payouts[j].recipient == p.recipient) revert InvalidPlan();
            total += p.amount;
            _payouts[id].push(p);
            emit Allocation(id, i, p.recipient, p.amount);
        }
        // Check the funding sum before accepting an immutable plan.
        uint256 funding = amountIn + maxPremium;
        if (funding == 0) revert InvalidPlan();
        _plans[id] = Plan(msg.sender, State.CREATED, deadline, amountIn, maxPremium, total, 0, 0, bytes32(0));
        emit PlanCreated(id, msg.sender, nonce, amountIn, maxPremium, deadline, total);
    }

    function fundPlan(bytes32 id) external nonReentrant {
        Plan storage p = _owned(id);
        if (p.state != State.CREATED || block.timestamp >= p.deadline) revert InvalidState();
        uint256 amount = p.amountIn + p.maxPremium;
        p.state = State.FUNDED;
        p.escrow = amount;
        totalEscrow += amount;
        uint256 beforeBalance = tokenIn.balanceOf(address(this));
        uint256 payerBefore = tokenIn.balanceOf(p.payer);
        tokenIn.safeTransferFrom(p.payer, address(this), amount);
        if (tokenIn.balanceOf(address(this)) != beforeBalance + amount || tokenIn.balanceOf(p.payer) + amount != payerBefore) revert InexactTransfer();
        emit PlanFunded(id, amount);
    }

    function acceptPlan(bytes32 id, FirmQuote calldata quote, ISwapVM.Order calldata order, bytes calldata signature)
        external nonReentrant returns (bytes32 commitmentId)
    {
        Plan storage p = _owned(id);
        if (p.state != State.FUNDED || block.timestamp >= p.deadline) revert InvalidState();
        if (quote.taker != address(this) || quote.executor != address(executor) || quote.swapRouter != router
            || quote.tokenIn != address(tokenIn) || quote.tokenOut != address(tokenOut) || quote.premiumToken != address(tokenIn)
            || quote.amountIn != p.amountIn || quote.minAmountOut < p.totalOut || quote.premiumAmount > p.maxPremium
            || quote.expiry > p.deadline) revert InvalidQuote();
        commitmentId = registry.quoteDigest(quote);
        if (commitmentPlan[commitmentId] != bytes32(0)) revert InvalidQuote();
        p.state = State.ACCEPTED;
        p.commitmentId = commitmentId;
        commitmentPlan[commitmentId] = id;
        p.premiumPaid = quote.premiumAmount;
        p.escrow -= quote.premiumAmount;
        totalEscrow -= quote.premiumAmount;
        uint256 beforeBalance = tokenIn.balanceOf(address(this));
        tokenIn.forceApprove(address(registry), quote.premiumAmount);
        if (registry.accept(quote, order, signature) != commitmentId) revert InvalidQuote();
        tokenIn.forceApprove(address(registry), 0);
        if (tokenIn.balanceOf(address(this)) + quote.premiumAmount != beforeBalance) revert InexactTransfer();
        emit PlanAccepted(id, commitmentId, quote.premiumAmount);
    }

    function executePlan(bytes32 id, ISwapVM.Order calldata order) external nonReentrant {
        Plan storage p = _owned(id);
        if (p.state != State.ACCEPTED) revert InvalidState();
        p.state = State.SETTLED;
        uint256 inputBefore = tokenIn.balanceOf(address(this));
        uint256 outputBefore = tokenOut.balanceOf(address(this));
        tokenIn.forceApprove(address(executor), p.amountIn);
        (CommitmentStatus status, uint256 proceeds) = executor.execute(p.commitmentId, order);
        tokenIn.forceApprove(address(executor), 0);
        if (tokenIn.balanceOf(address(this)) + p.amountIn != inputBefore || tokenOut.balanceOf(address(this)) != outputBefore + proceeds || proceeds < p.totalOut) revert InexactTransfer();
        uint256 refund = p.escrow - p.amountIn;
        totalEscrow -= p.escrow;
        p.escrow = 0;
        Payout[] storage payouts = _payouts[id];
        for (uint256 i; i < payouts.length; ++i) {
            _sendExact(tokenOut, payouts[i].recipient, payouts[i].amount);
            emit RecipientPaid(id, i, payouts[i].recipient, payouts[i].amount);
        }
        uint256 surplus = proceeds - p.totalOut;
        _sendExact(tokenOut, p.payer, surplus);
        _sendExact(tokenIn, p.payer, refund);
        if (tokenOut.balanceOf(address(this)) != outputBefore) revert InexactTransfer();
        emit PlanSettled(id, p.commitmentId, status, proceeds, surplus, refund);
    }

    function refundPlan(bytes32 id) external nonReentrant {
        Plan storage p = _owned(id);
        if (p.state == State.ACCEPTED) {
            Commitment memory c = registry.getCommitment(p.commitmentId);
            if (block.timestamp <= c.quote.expiry) revert NotExpired();
            if (c.status == CommitmentStatus.ACCEPTED) registry.expire(p.commitmentId);
            else if (c.status != CommitmentStatus.EXPIRED) revert InvalidState();
        } else if (p.state != State.CREATED && p.state != State.FUNDED) revert InvalidState();
        p.state = State.REFUNDED;
        uint256 amount = p.escrow;
        totalEscrow -= amount;
        p.escrow = 0;
        _sendExact(tokenIn, p.payer, amount);
        emit PlanRefunded(id, p.payer, amount);
    }
    function _owned(bytes32 id) private view returns (Plan storage p) {
        p = _plans[id];
        if (p.payer != msg.sender) revert Unauthorized();
    }
    function _sendExact(IERC20 token, address to, uint256 amount) private {
        if (amount == 0) return;
        uint256 beforeBalance = token.balanceOf(address(this));
        uint256 recipientBefore = token.balanceOf(to);
        token.safeTransfer(to, amount);
        if (token.balanceOf(address(this)) + amount != beforeBalance || token.balanceOf(to) != recipientBefore + amount) revert InexactTransfer();
    }
}

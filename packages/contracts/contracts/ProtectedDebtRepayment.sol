// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import {ProtectedSettlement} from "./ProtectedSettlement.sol";
import {FirmQuote} from "./types/FirmTypes.sol";

interface IAaveRepaymentPool {
    function ADDRESSES_PROVIDER() external view returns (address);
    function getConfiguration(address asset) external view returns (uint256);
    function getReserveNormalizedVariableDebt(address asset) external view returns (uint256);
    function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) external returns (uint256);
}
interface IAaveRepaymentProvider {
    function getPool() external view returns (address);
    function getPoolDataProvider() external view returns (address);
}
interface IAaveRepaymentDataProvider {
    function getReserveTokensAddresses(address asset) external view returns (address, address, address);
}
interface IAaveRepaymentDebt is IERC20 {
    function POOL() external view returns (address);
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
    function scaledBalanceOf(address user) external view returns (uint256);
}

/// @notice Fixed Aave variable-debt action composed around an unchanged ProtectedSettlement.
/// @dev The immutable deployment configuration is the complete external-call allowlist.
/// No admin, arbitrary calldata, delegatecall, debt delegation, or collateral withdrawal.
contract ProtectedDebtRepayment is ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct RepaymentPlan {
        address payer;
        address borrower;
        uint256 maxRepay;
        uint256 minRepay;
        bytes32 authorizationHash;
        bytes32 commitmentId;
        uint256 actualRepaid;
        uint256 debtBefore;
        uint256 debtAfter;
    }
    ProtectedSettlement public immutable settlement;
    IAaveRepaymentPool public immutable pool;
    IAaveRepaymentProvider public immutable addressesProvider;
    IAaveRepaymentDataProvider public immutable dataProvider;
    IAaveRepaymentDebt public immutable variableDebtToken;
    IERC20 public immutable tokenIn;
    IERC20 public immutable tokenOut;
    address public immutable aToken;
    uint256 public immutable authorizedChainId;
    uint256 public constant DEBT_MODE = 2;
    uint256 public constant RAY = 1e27;
    mapping(bytes32 => RepaymentPlan) private _plans;

    error Unauthorized();
    error InvalidRepayment();
    error IncompatibleReserve();
    error InexactTransfer();
    error DebtBelowMinimum();
    error InvalidDebtReduction();
    event RepaymentCreated(bytes32 indexed planId, address indexed payer, address indexed borrower, uint256 nonce, uint256 maxRepay, uint256 minRepay, bytes32 authorizationHash);
    event RepaymentAccepted(bytes32 indexed planId, bytes32 indexed commitmentId, bytes32 commitmentAuthorizationHash);
    event DebtRepaid(bytes32 indexed planId, bytes32 indexed commitmentId, address indexed borrower, uint256 actualRepaid, uint256 debtBefore, uint256 debtAfter, uint256 scaledDebtBefore, uint256 scaledDebtAfter, uint256 debtIndex, uint256 usdcRefund, uint256 wethRefund);
    event RepaymentRefunded(bytes32 indexed planId, address indexed payer, uint256 amount);

    constructor(address settlement_, address pool_, address variableDebtToken_, uint256 chainId_) {
        if (block.chainid != chainId_ || pool_.code.length == 0 || variableDebtToken_.code.length == 0) revert IncompatibleReserve();
        authorizedChainId = chainId_;
        settlement = ProtectedSettlement(settlement_);
        tokenIn = settlement.tokenIn();
        tokenOut = settlement.tokenOut();
        if (IERC20Metadata(address(tokenIn)).decimals() != 18 || IERC20Metadata(address(tokenOut)).decimals() != 6) revert IncompatibleReserve();
        pool = IAaveRepaymentPool(pool_);
        variableDebtToken = IAaveRepaymentDebt(variableDebtToken_);
        addressesProvider = IAaveRepaymentProvider(pool.ADDRESSES_PROVIDER());
        dataProvider = IAaveRepaymentDataProvider(addressesProvider.getPoolDataProvider());
        (address reserveAToken,,address reserveDebt) = dataProvider.getReserveTokensAddresses(address(tokenOut));
        if (reserveDebt != variableDebtToken_ || reserveAToken.code.length == 0) revert IncompatibleReserve();
        aToken = reserveAToken;
        _checkReserve();
    }

    function planIdFor(address payer, uint256 nonce) public view returns (bytes32) {
        return settlement.planIdFor(address(this), uint256(keccak256(abi.encode(authorizedChainId, address(this), payer, nonce))));
    }
    function getRepaymentPlan(bytes32 id) external view returns (RepaymentPlan memory repayment, ProtectedSettlement.Plan memory underlying) {
        return (_plans[id], settlement.getPlan(id));
    }
    function createRepaymentPlan(uint256 nonce, address borrower, address asset, uint256 debtMode, uint256 amountIn, uint256 maxPremium, uint64 deadline, uint256 maxRepay, uint256 minRepay)
        external nonReentrant returns (bytes32 id)
    {
        _checkReserve();
        if (borrower == address(0) || borrower == address(this) || asset != address(tokenOut) || debtMode != DEBT_MODE || minRepay == 0 || minRepay > maxRepay) revert InvalidRepayment();
        if (variableDebtToken.balanceOf(borrower) < minRepay) revert DebtBelowMinimum();
        id = planIdFor(msg.sender, nonce);
        if (_plans[id].payer != address(0)) revert InvalidRepayment();
        bytes32 authorizationHash = keccak256(abi.encode(authorizedChainId, address(this), msg.sender, borrower, address(pool), asset, address(variableDebtToken), debtMode, amountIn, maxPremium, deadline, maxRepay, minRepay, id));
        _plans[id] = RepaymentPlan(msg.sender, borrower, maxRepay, minRepay, authorizationHash, bytes32(0), 0, 0, 0);
        ProtectedSettlement.Payout[] memory allocation = new ProtectedSettlement.Payout[](1);
        allocation[0] = ProtectedSettlement.Payout(address(this), maxRepay);
        uint256 innerNonce = uint256(keccak256(abi.encode(authorizedChainId, address(this), msg.sender, nonce)));
        if (settlement.createPlan(innerNonce, amountIn, maxPremium, deadline, allocation) != id) revert InvalidRepayment();
        emit RepaymentCreated(id, msg.sender, borrower, nonce, maxRepay, minRepay, authorizationHash);
    }

    function fundPlan(bytes32 id) external nonReentrant {
        RepaymentPlan storage p = _owned(id);
        ProtectedSettlement.Plan memory underlying = settlement.getPlan(id);
        if (underlying.state != ProtectedSettlement.State.CREATED) revert InvalidRepayment();
        uint256 amount = underlying.amountIn + underlying.maxPremium;
        uint256 beforeBalance = tokenIn.balanceOf(address(this));
        uint256 payerBefore = tokenIn.balanceOf(p.payer);
        tokenIn.safeTransferFrom(p.payer, address(this), amount);
        if (tokenIn.balanceOf(address(this)) != beforeBalance + amount || tokenIn.balanceOf(p.payer) + amount != payerBefore) revert InexactTransfer();
        tokenIn.forceApprove(address(settlement), amount);
        settlement.fundPlan(id);
        tokenIn.forceApprove(address(settlement), 0);
        if (tokenIn.balanceOf(address(this)) != beforeBalance) revert InexactTransfer();
    }

    function acceptPlan(bytes32 id, FirmQuote calldata quote, ISwapVM.Order calldata order, bytes calldata signature)
        external nonReentrant returns (bytes32 commitmentId)
    {
        RepaymentPlan storage p = _owned(id);
        _checkReserve();
        if (variableDebtToken.balanceOf(p.borrower) < p.minRepay) revert DebtBelowMinimum();
        // The existing ProtectedSettlement, never the borrower or this adapter, is the signed taker.
        commitmentId = settlement.acceptPlan(id, quote, order, signature);
        p.commitmentId = commitmentId;
        emit RepaymentAccepted(id, commitmentId, keccak256(abi.encode(p.authorizationHash, commitmentId)));
    }

    function executePlan(bytes32 id, ISwapVM.Order calldata order) external nonReentrant {
        RepaymentPlan storage p = _owned(id);
        _checkReserve();
        ProtectedSettlement.Plan memory underlying = settlement.getPlan(id);
        if (underlying.state != ProtectedSettlement.State.ACCEPTED || underlying.commitmentId != p.commitmentId) revert InvalidRepayment();
        uint256 inputBefore = tokenIn.balanceOf(address(this));
        uint256 outputBefore = tokenOut.balanceOf(address(this));
        settlement.executePlan(id, order);
        uint256 proceeds = tokenOut.balanceOf(address(this)) - outputBefore;
        uint256 wethRefund = underlying.maxPremium - underlying.premiumPaid;
        if (proceeds < p.maxRepay || tokenIn.balanceOf(address(this)) != inputBefore + wethRefund) revert InexactTransfer();
        uint256 debtIndex = pool.getReserveNormalizedVariableDebt(address(tokenOut));
        if (debtIndex < RAY) revert InvalidDebtReduction();
        uint256 debtBefore = variableDebtToken.balanceOf(p.borrower);
        uint256 scaledBefore = variableDebtToken.scaledBalanceOf(p.borrower);
        uint256 amount = debtBefore < p.maxRepay ? debtBefore : p.maxRepay;
        if (amount < p.minRepay) revert DebtBelowMinimum();
        uint256 reserveBefore = tokenOut.balanceOf(aToken);
        tokenOut.forceApprove(address(pool), amount);
        uint256 repaid = pool.repay(address(tokenOut), amount, DEBT_MODE, p.borrower);
        tokenOut.forceApprove(address(pool), 0);
        uint256 debtAfter = variableDebtToken.balanceOf(p.borrower);
        uint256 scaledAfter = variableDebtToken.scaledBalanceOf(p.borrower);
        if (repaid < p.minRepay || repaid > amount || debtAfter >= debtBefore || scaledAfter >= scaledBefore) revert InvalidDebtReduction();
        uint256 reduction = debtBefore - debtAfter;
        uint256 rounding = reduction > repaid ? reduction - repaid : repaid - reduction;
        // Aave burns integer scaled units. Their underlying value grows with the
        // index, so a fixed one-micro-USDC tolerance is not valid for every index.
        uint256 scaledBurn = scaledBefore - scaledAfter;
        if (scaledBurn < Math.mulDiv(repaid, RAY, debtIndex) || scaledBurn > Math.mulDiv(repaid, RAY, debtIndex, Math.Rounding.Ceil)
            || rounding > Math.ceilDiv(debtIndex, RAY)) revert InvalidDebtReduction();
        if (tokenOut.balanceOf(address(this)) + repaid != outputBefore + proceeds || tokenOut.balanceOf(aToken) != reserveBefore + repaid) revert InexactTransfer();
        p.actualRepaid = repaid;
        p.debtBefore = debtBefore;
        p.debtAfter = debtAfter;
        _sendExact(tokenOut, p.payer, proceeds - repaid);
        _sendExact(tokenIn, p.payer, wethRefund);
        if (tokenOut.balanceOf(address(this)) != outputBefore || tokenIn.balanceOf(address(this)) != inputBefore) revert InexactTransfer();
        emit DebtRepaid(id, p.commitmentId, p.borrower, repaid, debtBefore, debtAfter, scaledBefore, scaledAfter, debtIndex, proceeds - repaid, wethRefund);
    }

    function refundPlan(bytes32 id) external nonReentrant {
        RepaymentPlan storage p = _owned(id);
        uint256 refund = settlement.getPlan(id).escrow;
        uint256 beforeBalance = tokenIn.balanceOf(address(this));
        settlement.refundPlan(id);
        if (tokenIn.balanceOf(address(this)) != beforeBalance + refund) revert InexactTransfer();
        _sendExact(tokenIn, p.payer, refund);
        if (tokenIn.balanceOf(address(this)) != beforeBalance) revert InexactTransfer();
        emit RepaymentRefunded(id, p.payer, refund);
    }
    function _owned(bytes32 id) private view returns (RepaymentPlan storage p) {
        if (block.chainid != authorizedChainId) revert IncompatibleReserve();
        p = _plans[id];
        if (p.payer != msg.sender) revert Unauthorized();
    }
    function _checkReserve() private view {
        if (block.chainid != authorizedChainId || addressesProvider.getPool() != address(pool) || addressesProvider.getPoolDataProvider() != address(dataProvider)) revert IncompatibleReserve();
        (address reserveAToken,,address debt) = dataProvider.getReserveTokensAddresses(address(tokenOut));
        uint256 configuration = pool.getConfiguration(address(tokenOut));
        if (reserveAToken != aToken || debt != address(variableDebtToken) || variableDebtToken.POOL() != address(pool)
            || variableDebtToken.UNDERLYING_ASSET_ADDRESS() != address(tokenOut) || ((configuration >> 56) & 1) != 1
            || ((configuration >> 60) & 1) != 0 || ((configuration >> 48) & 255) != 6) revert IncompatibleReserve();
    }
    function _sendExact(IERC20 token, address to, uint256 amount) private {
        if (amount == 0) return;
        uint256 beforeBalance = token.balanceOf(address(this));
        uint256 recipientBefore = token.balanceOf(to);
        token.safeTransfer(to, amount);
        if (token.balanceOf(address(this)) + amount != beforeBalance || token.balanceOf(to) != recipientBefore + amount) revert InexactTransfer();
    }
}

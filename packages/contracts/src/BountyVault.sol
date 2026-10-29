// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/**
 * @title BountyVault
 * @notice Holds funds for open-source bounties and the funder's spending mandate for each one.
 *
 * The mandate reuses the shape of Mandate's PermissionMirror.PermissionScope:
 * `maxPositionSizeUsdc` becomes `perPayoutCap`, `maxDailySpendUsdc` becomes `totalBudget`
 * (lifetime rather than daily), and `expiry` keeps its meaning. The protocol bitmask is
 * replaced by an explicit payee allowlist. Unlike Mandate, cumulative spend is tracked
 * on-chain (`spent`), so the budget check does not trust an off-chain counter.
 *
 * Phase 1 covers creation, funding, mandate updates and reads. Payouts arrive in a later
 * phase and will be gated on `checkPayout` plus proof verification.
 */
contract BountyVault {
    // ─── Types ───────────────────────────────────────────────────────────────

    struct Mandate {
        uint128 perPayoutCap;
        uint128 totalBudget;
        /// Unix seconds; payouts at or after this instant are rejected.
        uint64 expiry;
    }

    struct Bounty {
        address funder;
        uint64 issueNumber;
        uint128 payoutAmount;
        uint128 funded;
        uint128 spent;
        Mandate mandate;
        string repo;
    }

    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 public constant MAX_PAYEES = 16;

    // Violation bits, in the same order as packages/shared checkMandate().
    uint8 public constant AMOUNT_ZERO = 1 << 0;
    uint8 public constant EXCEEDS_PER_PAYOUT_CAP = 1 << 1;
    uint8 public constant EXCEEDS_TOTAL_BUDGET = 1 << 2;
    uint8 public constant PAYEE_NOT_ALLOWLISTED = 1 << 3;
    uint8 public constant MANDATE_EXPIRED = 1 << 4;

    // ─── State ───────────────────────────────────────────────────────────────

    IERC20 public immutable token;
    uint256 public bountyCount;

    mapping(uint256 id => Bounty) internal _bounties;
    mapping(uint256 id => address[]) private _payees;
    mapping(uint256 id => mapping(address payee => bool)) public isPayeeAllowed;

    // ─── Events ──────────────────────────────────────────────────────────────

    event BountyCreated(
        uint256 indexed id,
        address indexed funder,
        string repo,
        uint64 issueNumber,
        uint128 payoutAmount,
        Mandate mandate,
        address[] payees
    );
    event BountyFunded(uint256 indexed id, address indexed from, uint128 amount, uint128 totalFunded);
    event MandateUpdated(uint256 indexed id, Mandate mandate, address[] payees);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error BountyNotFound(uint256 id);
    error OnlyFunder(uint256 id, address caller);
    error InvalidRepo();
    error InvalidIssueNumber();
    error InvalidPayoutAmount();
    error CapExceedsBudget();
    error PayoutExceedsCap();
    error ExpiryInPast();
    error InvalidPayees();
    error BudgetBelowCommitted(uint128 budget, uint128 committed);
    error FundingExceedsBudget(uint128 wouldBeFunded, uint128 budget);
    error ZeroAmount();
    error TransferFailed();

    constructor(IERC20 _token) {
        token = _token;
    }

    // ─── Funder actions ──────────────────────────────────────────────────────

    function createBounty(
        string calldata repo,
        uint64 issueNumber,
        uint128 payoutAmount,
        Mandate calldata mandate,
        address[] calldata payees
    ) public returns (uint256 id) {
        if (bytes(repo).length == 0 || bytes(repo).length > 140) revert InvalidRepo();
        if (issueNumber == 0) revert InvalidIssueNumber();
        if (payoutAmount == 0) revert InvalidPayoutAmount();
        if (payoutAmount > mandate.perPayoutCap) revert PayoutExceedsCap();
        _validateMandate(mandate, 0);

        id = ++bountyCount;
        Bounty storage b = _bounties[id];
        b.funder = msg.sender;
        b.issueNumber = issueNumber;
        b.payoutAmount = payoutAmount;
        b.mandate = mandate;
        b.repo = repo;
        _setPayees(id, payees);

        emit BountyCreated(id, msg.sender, repo, issueNumber, payoutAmount, mandate, payees);
    }

    /// Create a bounty and fund it in one transaction (requires a prior token approval).
    function createAndFund(
        string calldata repo,
        uint64 issueNumber,
        uint128 payoutAmount,
        Mandate calldata mandate,
        address[] calldata payees,
        uint128 fundAmount
    ) external returns (uint256 id) {
        id = createBounty(repo, issueNumber, payoutAmount, mandate, payees);
        fund(id, fundAmount);
    }

    /// Anyone may top up a bounty, up to its total budget.
    function fund(uint256 id, uint128 amount) public {
        Bounty storage b = _get(id);
        if (amount == 0) revert ZeroAmount();
        uint128 newFunded = b.funded + amount;
        if (newFunded > b.mandate.totalBudget) revert FundingExceedsBudget(newFunded, b.mandate.totalBudget);
        b.funded = newFunded;
        emit BountyFunded(id, msg.sender, amount, newFunded);
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    /// Only the funder may change the mandate. The budget can never drop below what is funded or spent.
    function updateMandate(uint256 id, Mandate calldata mandate, address[] calldata payees) external {
        Bounty storage b = _get(id);
        if (msg.sender != b.funder) revert OnlyFunder(id, msg.sender);
        if (b.payoutAmount > mandate.perPayoutCap) revert PayoutExceedsCap();
        _validateMandate(mandate, b.funded > b.spent ? b.funded : b.spent);
        b.mandate = mandate;
        _setPayees(id, payees);
        emit MandateUpdated(id, mandate, payees);
    }

    // ─── Reads ───────────────────────────────────────────────────────────────

    function getBounty(uint256 id) external view returns (Bounty memory) {
        return _get(id);
    }

    function getPayees(uint256 id) external view returns (address[] memory) {
        _get(id);
        return _payees[id];
    }

    /**
     * @notice Deterministic mandate check for a prospective payout. Returns a bitmask of every
     *         violation (0 means compliant). Mirrors packages/shared checkMandate(), which mirrors
     *         Mandate's underwriting checks: amount, cap, cumulative budget, allowlist, expiry.
     */
    function checkPayout(uint256 id, address payee, uint128 amount) public view returns (uint8 violations) {
        Bounty storage b = _get(id);
        if (amount == 0) violations |= AMOUNT_ZERO;
        if (amount > b.mandate.perPayoutCap) violations |= EXCEEDS_PER_PAYOUT_CAP;
        if (uint256(b.spent) + amount > b.mandate.totalBudget) violations |= EXCEEDS_TOTAL_BUDGET;
        if (!isPayeeAllowed[id][payee]) violations |= PAYEE_NOT_ALLOWLISTED;
        if (block.timestamp >= b.mandate.expiry) violations |= MANDATE_EXPIRED;
    }

    // ─── Internals ───────────────────────────────────────────────────────────

    function _get(uint256 id) private view returns (Bounty storage b) {
        b = _bounties[id];
        if (b.funder == address(0)) revert BountyNotFound(id);
    }

    function _validateMandate(Mandate calldata m, uint128 committed) private view {
        if (m.perPayoutCap > m.totalBudget) revert CapExceedsBudget();
        if (m.expiry <= block.timestamp) revert ExpiryInPast();
        if (m.totalBudget < committed) revert BudgetBelowCommitted(m.totalBudget, committed);
    }

    function _setPayees(uint256 id, address[] calldata payees) private {
        if (payees.length == 0 || payees.length > MAX_PAYEES) revert InvalidPayees();
        address[] storage current = _payees[id];
        for (uint256 i = 0; i < current.length; i++) {
            isPayeeAllowed[id][current[i]] = false;
        }
        delete _payees[id];
        for (uint256 i = 0; i < payees.length; i++) {
            address p = payees[i];
            if (p == address(0) || isPayeeAllowed[id][p]) revert InvalidPayees();
            isPayeeAllowed[id][p] = true;
            current.push(p);
        }
    }
}

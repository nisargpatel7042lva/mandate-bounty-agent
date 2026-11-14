// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
}

/// zkVerify's aggregation contract on the destination chain (docs: proof-verification-smart-contract).
interface IVerifyProofAggregation {
    function verifyProofAggregation(
        uint256 domainId,
        uint256 aggregationId,
        bytes32 leaf,
        bytes32[] calldata merklePath,
        uint256 leafCount,
        uint256 index
    ) external view returns (bool);
}

/**
 * @title BountyVault
 * @notice Holds funds for open-source bounties and the funder's spending mandate for each one, and
 *         releases a payout only for a mandate proof that zkVerify has verified.
 *
 * The mandate reuses the shape of Mandate's PermissionMirror.PermissionScope:
 * `maxPositionSizeUsdc` becomes `perPayoutCap`, `maxDailySpendUsdc` becomes `totalBudget`
 * (lifetime rather than daily), and `expiry` keeps its meaning. The protocol bitmask is replaced by
 * an explicit payee allowlist. Unlike Mandate, cumulative spend is tracked on-chain (`spent`).
 *
 * `commitment` is the Poseidon commitment to (cap, budget, expiry, allowlist) that the mandate
 * circuit proves against. The funder sets it; the agent cannot substitute a friendlier mandate.
 *
 * Payout (`release`) is callable only by the agent's signer and requires, in aggregation mode, that
 * zkVerify's on-chain contract confirms a mandate proof whose public inputs this contract rebuilds
 * from its own state. Each bounty pays once; claims, PRs and proof references cannot be reused.
 */
contract BountyVault {
    // ─── Types ───────────────────────────────────────────────────────────────

    struct Mandate {
        uint128 perPayoutCap;
        uint128 totalBudget;
        /// Unix seconds; payouts at or after this instant are rejected.
        uint64 expiry;
        /// Poseidon(perPayoutCap, totalBudget, expiry, allowlistHash) as computed by packages/circuits.
        bytes32 commitment;
    }

    struct Bounty {
        address funder;
        uint64 issueNumber;
        uint128 payoutAmount;
        uint128 funded;
        uint128 spent;
        Mandate mandate;
        string repo;
        bool paid;
        /// Funder approved paying despite the advisory review recommending against it.
        bool reviewOverride;
    }

    /// zkVerify aggregation tuple for the mandate proof (from Kurier's job status).
    struct Aggregation {
        uint256 domainId;
        uint256 aggregationId;
        bytes32[] merklePath;
        uint256 leafCount;
        uint256 index;
    }

    struct Release {
        uint256 bountyId;
        address payee;
        uint128 amount;
        /// zkTLS claim identifier of the proven merged PR (public input of the mandate proof).
        bytes32 claimId;
        /// PR number the claim proves; with the bounty's repo, it may be paid only once.
        uint64 prNumber;
        /// `now` public input of the mandate proof: when the mandate check ran.
        uint64 checkedAt;
        /// Aggregation mode: ignored (the rebuilt leaf is the reference). Direct mode: the zkVerify
        /// verification tx hash, recorded by the agent's signer.
        bytes32 proofRef;
        Aggregation agg;
    }

    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 public constant MAX_PAYEES = 16;
    /// A mandate check older than this cannot be used for a payout.
    uint256 public constant MAX_CHECK_AGE = 1 days;

    // Violation bits, in the same order as packages/shared checkMandate().
    uint8 public constant AMOUNT_ZERO = 1 << 0;
    uint8 public constant EXCEEDS_PER_PAYOUT_CAP = 1 << 1;
    uint8 public constant EXCEEDS_TOTAL_BUDGET = 1 << 2;
    uint8 public constant PAYEE_NOT_ALLOWLISTED = 1 << 3;
    uint8 public constant MANDATE_EXPIRED = 1 << 4;

    // zkVerify Groth16 statement constants (docs: smart-contract tutorial).
    bytes32 public constant PROVING_SYSTEM_ID = keccak256(abi.encodePacked("groth16"));
    bytes32 public constant VERSION_HASH = sha256(abi.encodePacked(""));

    // ─── State ───────────────────────────────────────────────────────────────

    IERC20 public immutable token;
    address public owner;
    /// The agent's signer: the only address that may release payouts.
    address public agent;
    /// zkVerify aggregation contract on this chain.
    IVerifyProofAggregation public zkVerify;
    /// zkVerify vkHash of the mandate circuit's verification key.
    bytes32 public vkHash;
    /// True: payouts need an on-chain zkVerify aggregation check. False: the agent records the zkVerify
    /// tx hash instead (weaker; for when aggregation to this chain is unavailable).
    bool public aggregationRequired;

    uint256 public bountyCount;

    mapping(uint256 id => Bounty) internal _bounties;
    mapping(uint256 id => address[]) private _payees;
    mapping(uint256 id => mapping(address payee => bool)) public isPayeeAllowed;

    mapping(bytes32 claimId => bool) public claimUsed;
    mapping(bytes32 prKey => bool) public prPaid;
    mapping(bytes32 proofRef => bool) public proofRefUsed;

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
    event ReviewOverrideApproved(uint256 indexed id, address indexed funder);
    event PayoutReleased(
        uint256 indexed id,
        address indexed payee,
        uint128 amount,
        bytes32 claimId,
        uint64 prNumber,
        bytes32 proofRef,
        uint128 spentAfter
    );
    event AgentUpdated(address indexed agent);
    event VerificationUpdated(address indexed zkVerify, bytes32 vkHash, bool aggregationRequired);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error BountyNotFound(uint256 id);
    error OnlyFunder(uint256 id, address caller);
    error OnlyOwner();
    error OnlyAgent();
    error InvalidRepo();
    error InvalidIssueNumber();
    error InvalidPayoutAmount();
    error CapExceedsBudget();
    error PayoutExceedsCap();
    error ExpiryInPast();
    error InvalidPayees();
    error InvalidCommitment();
    error BudgetBelowCommitted(uint128 budget, uint128 committed);
    error FundingExceedsBudget(uint128 wouldBeFunded, uint128 budget);
    error ZeroAmount();
    error TransferFailed();
    error AlreadyPaid(uint256 id);
    error WrongAmount(uint128 amount, uint128 payoutAmount);
    error MandateViolation(uint8 violations);
    error InsufficientFunds(uint128 available, uint128 amount);
    error CheckTooOld(uint64 checkedAt);
    error CheckInFuture(uint64 checkedAt);
    error ClaimAlreadyUsed(bytes32 claimId);
    error PrAlreadyPaid(string repo, uint64 prNumber);
    error ProofRefAlreadyUsed(bytes32 proofRef);
    error MissingProofRef();
    error ProofNotVerified(bytes32 leaf);

    constructor(IERC20 _token, address _agent, IVerifyProofAggregation _zkVerify, bytes32 _vkHash, bool _aggregationRequired) {
        token = _token;
        owner = msg.sender;
        agent = _agent;
        zkVerify = _zkVerify;
        vkHash = _vkHash;
        aggregationRequired = _aggregationRequired;
        emit AgentUpdated(_agent);
        emit VerificationUpdated(address(_zkVerify), _vkHash, _aggregationRequired);
    }

    // ─── Admin (testnet operator) ────────────────────────────────────────────

    function setAgent(address _agent) external {
        if (msg.sender != owner) revert OnlyOwner();
        agent = _agent;
        emit AgentUpdated(_agent);
    }

    function setVerification(IVerifyProofAggregation _zkVerify, bytes32 _vkHash, bool _aggregationRequired) external {
        if (msg.sender != owner) revert OnlyOwner();
        zkVerify = _zkVerify;
        vkHash = _vkHash;
        aggregationRequired = _aggregationRequired;
        emit VerificationUpdated(address(_zkVerify), _vkHash, _aggregationRequired);
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

    /// The advisory review said "not met" and the agent held the payout. The funder can still approve
    /// paying; the proofs (merge + mandate) are required either way.
    function approveDespiteReview(uint256 id) external {
        Bounty storage b = _get(id);
        if (msg.sender != b.funder) revert OnlyFunder(id, msg.sender);
        b.reviewOverride = true;
        emit ReviewOverrideApproved(id, msg.sender);
    }

    // ─── Payout ──────────────────────────────────────────────────────────────

    /**
     * @notice Pays the bounty once, to an allowlisted payee, for a mandate proof verified by zkVerify.
     *         Every input the proof commits to is rebuilt here from the vault's own state, so the agent
     *         cannot pay against a different mandate, bounty, amount, payee, spend or claim.
     */
    function release(Release calldata r) external {
        if (msg.sender != agent) revert OnlyAgent();
        Bounty storage b = _get(r.bountyId);
        if (b.paid) revert AlreadyPaid(r.bountyId);
        if (r.amount != b.payoutAmount) revert WrongAmount(r.amount, b.payoutAmount);

        uint8 violations = checkPayout(r.bountyId, r.payee, r.amount);
        if (violations != 0) revert MandateViolation(violations);
        uint128 available = b.funded - b.spent;
        if (available < r.amount) revert InsufficientFunds(available, r.amount);

        if (r.checkedAt > block.timestamp) revert CheckInFuture(r.checkedAt);
        if (block.timestamp - r.checkedAt > MAX_CHECK_AGE) revert CheckTooOld(r.checkedAt);

        if (claimUsed[r.claimId]) revert ClaimAlreadyUsed(r.claimId);
        bytes32 prKey = keccak256(abi.encode(b.repo, r.prNumber));
        if (prPaid[prKey]) revert PrAlreadyPaid(b.repo, r.prNumber);

        bytes32 proofRef = _verifyMandateProof(b, r);
        if (proofRefUsed[proofRef]) revert ProofRefAlreadyUsed(proofRef);

        b.paid = true;
        b.spent += r.amount;
        claimUsed[r.claimId] = true;
        prPaid[prKey] = true;
        proofRefUsed[proofRef] = true;
        emit PayoutReleased(r.bountyId, r.payee, r.amount, r.claimId, r.prNumber, proofRef, b.spent);

        if (!token.transfer(r.payee, r.amount)) revert TransferFailed();
    }

    function _verifyMandateProof(Bounty storage b, Release calldata r) private view returns (bytes32) {
        if (!aggregationRequired) {
            if (r.proofRef == bytes32(0)) revert MissingProofRef();
            return r.proofRef;
        }
        uint256[8] memory pubs = [
            uint256(b.mandate.commitment),
            r.bountyId,
            uint256(r.amount),
            uint256(uint160(r.payee)),
            uint256(b.spent),
            uint256(r.checkedAt),
            uint256(r.claimId) >> 128,
            uint256(r.claimId) & type(uint128).max
        ];
        bytes32 leaf = statementLeaf(pubs);
        bool ok = zkVerify.verifyProofAggregation(r.agg.domainId, r.agg.aggregationId, leaf, r.agg.merklePath, r.agg.leafCount, r.agg.index);
        if (!ok) revert ProofNotVerified(leaf);
        return leaf;
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

    /**
     * @notice zkVerify's Groth16 statement leaf for the mandate proof's public inputs:
     *         keccak256(PROVING_SYSTEM_ID ‖ vkHash ‖ VERSION_HASH ‖ keccak256(LE32(p0) ‖ … ‖ LE32(p7))).
     *         packages/zkverify statementLeaf() computes the same; a shared vector keeps them equal.
     */
    function statementLeaf(uint256[8] memory pubs) public view returns (bytes32) {
        bytes memory packed;
        for (uint256 i = 0; i < pubs.length; i++) {
            packed = abi.encodePacked(packed, _toLittleEndian(pubs[i]));
        }
        return keccak256(abi.encodePacked(PROVING_SYSTEM_ID, vkHash, VERSION_HASH, keccak256(packed)));
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
        if (m.commitment == bytes32(0)) revert InvalidCommitment();
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

    /// Byte-reverses a 256-bit word (big-endian EVM word -> zkVerify's little-endian scalar bytes).
    function _toLittleEndian(uint256 input) private pure returns (uint256 v) {
        v = input;
        v = ((v & 0xFF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00) >> 8)
            | ((v & 0x00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF) << 8);
        v = ((v & 0xFFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000) >> 16)
            | ((v & 0x0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF) << 16);
        v = ((v & 0xFFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000) >> 32)
            | ((v & 0x00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF) << 32);
        v = ((v & 0xFFFFFFFFFFFFFFFF0000000000000000FFFFFFFFFFFFFFFF0000000000000000) >> 64)
            | ((v & 0x0000000000000000FFFFFFFFFFFFFFFF0000000000000000FFFFFFFFFFFFFFFF) << 64);
        v = (v >> 128) | (v << 128);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Test } from "forge-std/Test.sol";
import { BountyVault, IERC20 } from "../src/BountyVault.sol";
import { MockUSDC } from "../src/MockUSDC.sol";

/// Exposes `spent` so mandate vectors with prior spend can run before payouts exist.
contract BountyVaultHarness is BountyVault {
    constructor(IERC20 t) BountyVault(t) {}

    function setSpent(uint256 id, uint128 spent) external {
        _bounties[id].spent = spent;
    }
}

contract BountyVaultTest is Test {
    MockUSDC usdc;
    BountyVaultHarness vault;

    address funder = makeAddr("funder");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address mallory = makeAddr("mallory");

    uint128 constant CAP = 500e6;
    uint128 constant BUDGET = 1_000e6;
    uint128 constant PAYOUT = 250e6;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        vault = new BountyVaultHarness(IERC20(address(usdc)));
        vm.startPrank(funder);
        usdc.faucet(10_000e6);
        usdc.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function _mandate() internal view returns (BountyVault.Mandate memory) {
        return BountyVault.Mandate({ perPayoutCap: CAP, totalBudget: BUDGET, expiry: uint64(block.timestamp + 30 days) });
    }

    function _payees() internal view returns (address[] memory p) {
        p = new address[](2);
        p[0] = alice;
        p[1] = bob;
    }

    function _create() internal returns (uint256 id) {
        vm.prank(funder);
        id = vault.createBounty("acme/widgets", 42, PAYOUT, _mandate(), _payees());
    }

    // ─── Create ──────────────────────────────────────────────────────────────

    function test_create_storesBountyAndMandate() public {
        uint256 id = _create();
        assertEq(id, 1);
        assertEq(vault.bountyCount(), 1);

        BountyVault.Bounty memory b = vault.getBounty(id);
        assertEq(b.funder, funder);
        assertEq(b.repo, "acme/widgets");
        assertEq(b.issueNumber, 42);
        assertEq(b.payoutAmount, PAYOUT);
        assertEq(b.funded, 0);
        assertEq(b.spent, 0);
        assertEq(b.mandate.perPayoutCap, CAP);
        assertEq(b.mandate.totalBudget, BUDGET);
        assertEq(b.mandate.expiry, block.timestamp + 30 days);

        address[] memory p = vault.getPayees(id);
        assertEq(p.length, 2);
        assertTrue(vault.isPayeeAllowed(id, alice));
        assertTrue(vault.isPayeeAllowed(id, bob));
        assertFalse(vault.isPayeeAllowed(id, mallory));
    }

    function test_create_emitsEvent() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit BountyVault.BountyCreated(1, funder, "acme/widgets", 42, PAYOUT, _mandate(), _payees());
        _create();
    }

    function test_createAndFund_inOneTx() public {
        vm.prank(funder);
        uint256 id = vault.createAndFund("acme/widgets", 42, PAYOUT, _mandate(), _payees(), 600e6);
        assertEq(vault.getBounty(id).funded, 600e6);
        assertEq(usdc.balanceOf(address(vault)), 600e6);
    }

    // ─── Invalid params ──────────────────────────────────────────────────────

    function test_create_rejectsEmptyRepo() public {
        vm.prank(funder);
        vm.expectRevert(BountyVault.InvalidRepo.selector);
        vault.createBounty("", 42, PAYOUT, _mandate(), _payees());
    }

    function test_create_rejectsZeroIssue() public {
        vm.prank(funder);
        vm.expectRevert(BountyVault.InvalidIssueNumber.selector);
        vault.createBounty("acme/widgets", 0, PAYOUT, _mandate(), _payees());
    }

    function test_create_rejectsZeroPayout() public {
        vm.prank(funder);
        vm.expectRevert(BountyVault.InvalidPayoutAmount.selector);
        vault.createBounty("acme/widgets", 42, 0, _mandate(), _payees());
    }

    function test_create_rejectsPayoutAboveCap() public {
        vm.prank(funder);
        vm.expectRevert(BountyVault.PayoutExceedsCap.selector);
        vault.createBounty("acme/widgets", 42, CAP + 1, _mandate(), _payees());
    }

    function test_create_rejectsCapAboveBudget() public {
        BountyVault.Mandate memory m = _mandate();
        m.perPayoutCap = BUDGET + 1;
        vm.prank(funder);
        vm.expectRevert(BountyVault.CapExceedsBudget.selector);
        vault.createBounty("acme/widgets", 42, PAYOUT, m, _payees());
    }

    function test_create_rejectsPastExpiry() public {
        BountyVault.Mandate memory m = _mandate();
        m.expiry = uint64(block.timestamp);
        vm.prank(funder);
        vm.expectRevert(BountyVault.ExpiryInPast.selector);
        vault.createBounty("acme/widgets", 42, PAYOUT, m, _payees());
    }

    function test_create_rejectsEmptyPayees() public {
        vm.prank(funder);
        vm.expectRevert(BountyVault.InvalidPayees.selector);
        vault.createBounty("acme/widgets", 42, PAYOUT, _mandate(), new address[](0));
    }

    function test_create_rejectsZeroAddressPayee() public {
        address[] memory p = new address[](1);
        vm.prank(funder);
        vm.expectRevert(BountyVault.InvalidPayees.selector);
        vault.createBounty("acme/widgets", 42, PAYOUT, _mandate(), p);
    }

    function test_create_rejectsDuplicatePayee() public {
        address[] memory p = new address[](2);
        p[0] = alice;
        p[1] = alice;
        vm.prank(funder);
        vm.expectRevert(BountyVault.InvalidPayees.selector);
        vault.createBounty("acme/widgets", 42, PAYOUT, _mandate(), p);
    }

    function test_create_rejectsTooManyPayees() public {
        address[] memory p = new address[](vault.MAX_PAYEES() + 1);
        for (uint256 i = 0; i < p.length; i++) p[i] = address(uint160(i + 1));
        vm.prank(funder);
        vm.expectRevert(BountyVault.InvalidPayees.selector);
        vault.createBounty("acme/widgets", 42, PAYOUT, _mandate(), p);
    }

    // ─── Fund ────────────────────────────────────────────────────────────────

    function test_fund_movesTokensAndEmits() public {
        uint256 id = _create();
        vm.expectEmit(true, true, false, true, address(vault));
        emit BountyVault.BountyFunded(id, funder, 400e6, 400e6);
        vm.prank(funder);
        vault.fund(id, 400e6);
        assertEq(vault.getBounty(id).funded, 400e6);
        assertEq(usdc.balanceOf(address(vault)), 400e6);
        assertEq(usdc.balanceOf(funder), 10_000e6 - 400e6);
    }

    function test_fund_anyoneCanTopUp() public {
        uint256 id = _create();
        vm.startPrank(mallory);
        usdc.faucet(100e6);
        usdc.approve(address(vault), 100e6);
        vault.fund(id, 100e6);
        vm.stopPrank();
        assertEq(vault.getBounty(id).funded, 100e6);
    }

    function test_fund_rejectsAboveBudget() public {
        uint256 id = _create();
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.FundingExceedsBudget.selector, BUDGET + 1, BUDGET));
        vault.fund(id, BUDGET + 1);
    }

    function test_fund_rejectsZero() public {
        uint256 id = _create();
        vm.prank(funder);
        vm.expectRevert(BountyVault.ZeroAmount.selector);
        vault.fund(id, 0);
    }

    function test_fund_rejectsUnknownBounty() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.BountyNotFound.selector, 99));
        vault.fund(99, 1);
    }

    function test_fund_rejectsWithoutAllowance() public {
        uint256 id = _create();
        vm.prank(mallory);
        vm.expectRevert(MockUSDC.InsufficientAllowance.selector);
        vault.fund(id, 1);
    }

    // ─── Only funder can modify ──────────────────────────────────────────────

    function test_updateMandate_byFunder() public {
        uint256 id = _create();
        BountyVault.Mandate memory m = _mandate();
        m.perPayoutCap = 300e6;
        address[] memory p = new address[](1);
        p[0] = mallory;

        vm.prank(funder);
        vault.updateMandate(id, m, p);

        assertEq(vault.getBounty(id).mandate.perPayoutCap, 300e6);
        assertTrue(vault.isPayeeAllowed(id, mallory));
        assertFalse(vault.isPayeeAllowed(id, alice), "old payees are cleared");
        assertFalse(vault.isPayeeAllowed(id, bob), "old payees are cleared");
        assertEq(vault.getPayees(id).length, 1);
    }

    function test_updateMandate_rejectsNonFunder() public {
        uint256 id = _create();
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.OnlyFunder.selector, id, mallory));
        vault.updateMandate(id, _mandate(), _payees());
    }

    function test_updateMandate_cannotDropBudgetBelowFunded() public {
        uint256 id = _create();
        vm.prank(funder);
        vault.fund(id, 800e6);
        BountyVault.Mandate memory m = _mandate();
        m.totalBudget = 700e6;
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.BudgetBelowCommitted.selector, 700e6, 800e6));
        vault.updateMandate(id, m, _payees());
    }

    function test_updateMandate_cannotCapBelowPayout() public {
        uint256 id = _create();
        BountyVault.Mandate memory m = _mandate();
        m.perPayoutCap = PAYOUT - 1;
        vm.prank(funder);
        vm.expectRevert(BountyVault.PayoutExceedsCap.selector);
        vault.updateMandate(id, m, _payees());
    }

    // ─── Mandate check vs shared vectors ─────────────────────────────────────

    function test_checkPayout_matchesSharedVectors() public {
        string memory json = vm.readFile("../shared/test-vectors/mandate.json");
        uint256 n = abi.decode(vm.parseJson(json, ".cases"), (bytes[])).length;
        assertGt(n, 0);

        for (uint256 i = 0; i < n; i++) {
            uint256 snap = vm.snapshotState();
            _runVector(_loadVector(json, i));
            vm.revertToState(snap);
        }
    }

    struct Vector {
        string name;
        uint128 cap;
        uint128 budget;
        uint128 spent;
        uint128 amount;
        bool payeeAllowed;
        int256 secondsUntilExpiry;
        uint256 mask;
    }

    function _loadVector(string memory json, uint256 i) internal pure returns (Vector memory v) {
        string memory c = string.concat(".cases[", vm.toString(i), "]");
        v.name = vm.parseJsonString(json, string.concat(c, ".name"));
        v.cap = uint128(vm.parseJsonUint(json, string.concat(c, ".cap")));
        v.budget = uint128(vm.parseJsonUint(json, string.concat(c, ".budget")));
        v.spent = uint128(vm.parseJsonUint(json, string.concat(c, ".spentSoFar")));
        v.amount = uint128(vm.parseJsonUint(json, string.concat(c, ".amount")));
        v.payeeAllowed = vm.parseJsonBool(json, string.concat(c, ".payeeAllowed"));
        v.secondsUntilExpiry = vm.parseJsonInt(json, string.concat(c, ".secondsUntilExpiry"));
        v.mask = vm.parseJsonUint(json, string.concat(c, ".mask"));
    }

    function _runVector(Vector memory v) internal {
        uint64 expiry = uint64(block.timestamp + 1 days);
        BountyVault.Mandate memory m = BountyVault.Mandate({ perPayoutCap: v.cap, totalBudget: v.budget, expiry: expiry });
        vm.prank(funder);
        uint256 id = vault.createBounty("acme/widgets", 1, 1, m, _payees());
        vault.setSpent(id, v.spent);
        vm.warp(uint256(int256(uint256(expiry)) - v.secondsUntilExpiry));
        assertEq(vault.checkPayout(id, v.payeeAllowed ? alice : mallory, v.amount), v.mask, v.name);
    }

    // ─── Faucet ──────────────────────────────────────────────────────────────

    function test_faucet_capsMint() public {
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.FaucetLimitExceeded.selector, 10_000e6 + 1, 10_000e6));
        usdc.faucet(10_000e6 + 1);
    }
}

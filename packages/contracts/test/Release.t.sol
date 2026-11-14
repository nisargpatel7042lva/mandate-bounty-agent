// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Test } from "forge-std/Test.sol";
import { BountyVault, IERC20, IVerifyProofAggregation } from "../src/BountyVault.sol";
import { MockUSDC } from "../src/MockUSDC.sol";
import { MockZkVerify } from "../src/MockZkVerify.sol";

contract ReleaseTest is Test {
    MockUSDC usdc;
    MockZkVerify zk;
    BountyVault vault;

    address funder = makeAddr("funder");
    address agent = makeAddr("agent");
    address payee = makeAddr("payee");
    address mallory = makeAddr("mallory");

    bytes32 constant VK_HASH = 0x5f6a0bc1f8a3a1d7c2e9b4f00112233445566778899aabbccddeeff001122334;
    bytes32 constant COMMITMENT = bytes32(uint256(123456789012345678901234567890));
    bytes32 constant CLAIM = 0x1f0e5c3b7a9d2e4f6081a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5;
    uint128 constant CAP = 500e6;
    uint128 constant BUDGET = 1_000e6;
    uint128 constant PAYOUT = 250e6;
    uint64 constant PR = 3;
    uint256 constant DOMAIN = 0;
    uint256 constant AGG_ID = 29537;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        zk = new MockZkVerify();
        vault = new BountyVault(IERC20(address(usdc)), agent, zk, VK_HASH, true);
        vm.startPrank(funder);
        usdc.faucet(10_000e6);
        usdc.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function _bounty(string memory repo) internal returns (uint256 id) {
        address[] memory payees = new address[](1);
        payees[0] = payee;
        vm.prank(funder);
        id = vault.createAndFund(
            repo, 1, PAYOUT, BountyVault.Mandate({ perPayoutCap: CAP, totalBudget: BUDGET, expiry: uint64(block.timestamp + 30 days), commitment: COMMITMENT }), payees, 400e6
        );
    }

    function _release(uint256 id, bytes32 claim, uint64 pr) internal view returns (BountyVault.Release memory r) {
        bytes32[] memory path = new bytes32[](2);
        path[0] = keccak256("sibling-0");
        path[1] = keccak256("sibling-1");
        r = BountyVault.Release({
            bountyId: id,
            payee: payee,
            amount: PAYOUT,
            claimId: claim,
            prNumber: pr,
            checkedAt: uint64(block.timestamp - 600),
            proofRef: bytes32(0),
            agg: BountyVault.Aggregation({ domainId: DOMAIN, aggregationId: AGG_ID, merklePath: path, leafCount: 8, index: 6 })
        });
    }

    /// The leaf the vault will rebuild for `r`, marked as aggregated on the mock zkVerify contract.
    function _aggregate(BountyVault.Release memory r) internal returns (bytes32 leaf) {
        BountyVault.Bounty memory b = vault.getBounty(r.bountyId);
        uint256[8] memory pubs = [
            uint256(COMMITMENT),
            r.bountyId,
            uint256(r.amount),
            uint256(uint160(r.payee)),
            uint256(b.spent),
            uint256(r.checkedAt),
            uint256(r.claimId) >> 128,
            uint256(r.claimId) & type(uint128).max
        ];
        leaf = vault.statementLeaf(pubs);
        zk.markAggregated(r.agg.domainId, r.agg.aggregationId, leaf);
    }

    // ─── zkVerify leaf matches the TypeScript implementation ────────────────

    function test_statementLeaf_matchesSharedVector() public view {
        string memory json = vm.readFile("../zkverify/test-vectors/leaf.json");
        assertEq(vm.parseJsonBytes32(json, ".vkHash"), VK_HASH);
        uint256[8] memory pubs;
        for (uint256 i = 0; i < 8; i++) {
            pubs[i] = vm.parseUint(vm.parseJsonString(json, string.concat(".publicSignals[", vm.toString(i), "]")));
        }
        assertEq(vault.statementLeaf(pubs), vm.parseJsonBytes32(json, ".leaf"));
    }

    // ─── Happy path ──────────────────────────────────────────────────────────

    function test_release_paysOnceForAVerifiedProof() public {
        uint256 id = _bounty("acme/widgets");
        BountyVault.Release memory r = _release(id, CLAIM, PR);
        bytes32 leaf = _aggregate(r);

        vm.expectEmit(true, true, false, true, address(vault));
        emit BountyVault.PayoutReleased(id, payee, PAYOUT, CLAIM, PR, leaf, PAYOUT);
        vm.prank(agent);
        vault.release(r);

        assertEq(usdc.balanceOf(payee), PAYOUT);
        BountyVault.Bounty memory b = vault.getBounty(id);
        assertTrue(b.paid);
        assertEq(b.spent, PAYOUT);
        assertTrue(vault.claimUsed(CLAIM));
        assertTrue(vault.proofRefUsed(leaf));
    }

    // ─── Replay protection ───────────────────────────────────────────────────

    function test_release_secondPayoutForSameBountyFails() public {
        uint256 id = _bounty("acme/widgets");
        BountyVault.Release memory r = _release(id, CLAIM, PR);
        _aggregate(r);
        vm.prank(agent);
        vault.release(r);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.AlreadyPaid.selector, id));
        vault.release(r);
    }

    function test_release_sameClaimOnAnotherBountyFails() public {
        uint256 a = _bounty("acme/widgets");
        uint256 b = _bounty("acme/gadgets");
        BountyVault.Release memory ra = _release(a, CLAIM, PR);
        _aggregate(ra);
        vm.prank(agent);
        vault.release(ra);

        BountyVault.Release memory rb = _release(b, CLAIM, 9);
        _aggregate(rb);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.ClaimAlreadyUsed.selector, CLAIM));
        vault.release(rb);
    }

    function test_release_samePrTwiceFails() public {
        uint256 a = _bounty("acme/widgets");
        uint256 b = _bounty("acme/widgets");
        BountyVault.Release memory ra = _release(a, CLAIM, PR);
        _aggregate(ra);
        vm.prank(agent);
        vault.release(ra);

        // A fresh proof (new claim id) of the same PR, for another bounty on the same repo.
        BountyVault.Release memory rb = _release(b, keccak256("another proof run"), PR);
        _aggregate(rb);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.PrAlreadyPaid.selector, "acme/widgets", PR));
        vault.release(rb);
    }

    function test_release_proofRefReuseFailsInDirectMode() public {
        vault.setVerification(zk, VK_HASH, false); // test contract is the owner
        uint256 a = _bounty("acme/widgets");
        uint256 b = _bounty("acme/gadgets");
        BountyVault.Release memory ra = _release(a, CLAIM, PR);
        ra.proofRef = keccak256("zkverify tx");
        vm.prank(agent);
        vault.release(ra);

        BountyVault.Release memory rb = _release(b, keccak256("other claim"), 4);
        rb.proofRef = ra.proofRef;
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.ProofRefAlreadyUsed.selector, ra.proofRef));
        vault.release(rb);
    }

    // ─── Authorization and verification ──────────────────────────────────────

    function test_release_unauthorizedCallerFails() public {
        uint256 id = _bounty("acme/widgets");
        BountyVault.Release memory r = _release(id, CLAIM, PR);
        _aggregate(r);
        vm.prank(mallory);
        vm.expectRevert(BountyVault.OnlyAgent.selector);
        vault.release(r);
        vm.prank(funder);
        vm.expectRevert(BountyVault.OnlyAgent.selector);
        vault.release(r);
    }

    function test_release_unverifiedProofFails() public {
        uint256 id = _bounty("acme/widgets");
        BountyVault.Release memory r = _release(id, CLAIM, PR); // never aggregated
        vm.prank(agent);
        vm.expectPartialRevert(BountyVault.ProofNotVerified.selector);
        vault.release(r);
    }

    function test_release_proofForDifferentInputsFails() public {
        uint256 id = _bounty("acme/widgets");
        BountyVault.Release memory r = _release(id, CLAIM, PR);
        _aggregate(r);
        // Same aggregation, but the agent tries to pay someone else / bind another claim.
        BountyVault.Release memory other = _release(id, keccak256("other claim"), PR);
        vm.prank(agent);
        vm.expectPartialRevert(BountyVault.ProofNotVerified.selector);
        vault.release(other);
    }

    function test_release_directModeNeedsAProofRef() public {
        vault.setVerification(zk, VK_HASH, false);
        uint256 id = _bounty("acme/widgets");
        vm.prank(agent);
        vm.expectRevert(BountyVault.MissingProofRef.selector);
        vault.release(_release(id, CLAIM, PR));
    }

    // ─── Mandate and freshness ───────────────────────────────────────────────

    function test_release_payeeNotAllowlistedFails() public {
        uint256 id = _bounty("acme/widgets");
        BountyVault.Release memory r = _release(id, CLAIM, PR);
        r.payee = mallory;
        uint8 bit = vault.PAYEE_NOT_ALLOWLISTED();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.MandateViolation.selector, bit));
        vault.release(r);
    }

    function test_release_wrongAmountFails() public {
        uint256 id = _bounty("acme/widgets");
        BountyVault.Release memory r = _release(id, CLAIM, PR);
        r.amount = CAP;
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.WrongAmount.selector, CAP, PAYOUT));
        vault.release(r);
    }

    function test_release_expiredMandateFails() public {
        uint256 id = _bounty("acme/widgets");
        vm.warp(block.timestamp + 31 days);
        BountyVault.Release memory r = _release(id, CLAIM, PR);
        uint8 bit = vault.MANDATE_EXPIRED();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.MandateViolation.selector, bit));
        vault.release(r);
    }

    function test_release_staleOrFutureCheckFails() public {
        uint256 id = _bounty("acme/widgets");
        BountyVault.Release memory r = _release(id, CLAIM, PR);
        r.checkedAt = uint64(block.timestamp - 1 days - 1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.CheckTooOld.selector, r.checkedAt));
        vault.release(r);

        r.checkedAt = uint64(block.timestamp + 1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.CheckInFuture.selector, r.checkedAt));
        vault.release(r);
    }

    function test_release_underfundedFails() public {
        address[] memory payees = new address[](1);
        payees[0] = payee;
        vm.prank(funder);
        uint256 id = vault.createAndFund(
            "acme/widgets", 1, PAYOUT, BountyVault.Mandate({ perPayoutCap: CAP, totalBudget: BUDGET, expiry: uint64(block.timestamp + 30 days), commitment: COMMITMENT }), payees, 100e6
        );
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.InsufficientFunds.selector, uint128(100e6), PAYOUT));
        vault.release(_release(id, CLAIM, PR));
    }

    // ─── Admin and funder override ───────────────────────────────────────────

    function test_onlyOwnerConfigures() public {
        vm.prank(mallory);
        vm.expectRevert(BountyVault.OnlyOwner.selector);
        vault.setAgent(mallory);
        vm.prank(mallory);
        vm.expectRevert(BountyVault.OnlyOwner.selector);
        vault.setVerification(IVerifyProofAggregation(address(0)), bytes32(0), false);
    }

    function test_onlyFunderApprovesDespiteReview() public {
        uint256 id = _bounty("acme/widgets");
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(BountyVault.OnlyFunder.selector, id, mallory));
        vault.approveDespiteReview(id);

        vm.expectEmit(true, true, false, false, address(vault));
        emit BountyVault.ReviewOverrideApproved(id, funder);
        vm.prank(funder);
        vault.approveDespiteReview(id);
        assertTrue(vault.getBounty(id).reviewOverride);
    }

    function test_createRequiresACommitment() public {
        address[] memory payees = new address[](1);
        payees[0] = payee;
        vm.prank(funder);
        vm.expectRevert(BountyVault.InvalidCommitment.selector);
        vault.createBounty("acme/widgets", 1, PAYOUT, BountyVault.Mandate({ perPayoutCap: CAP, totalBudget: BUDGET, expiry: uint64(block.timestamp + 1 days), commitment: bytes32(0) }), payees);
    }
}

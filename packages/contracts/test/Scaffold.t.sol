// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Test } from "forge-std/Test.sol";

/// Placeholder until BountyVault lands in Phase 1; proves the Foundry toolchain is wired.
contract ScaffoldTest is Test {
    function test_toolchainIsWired() public pure {
        assertEq(uint256(1) + 1, 2);
    }
}

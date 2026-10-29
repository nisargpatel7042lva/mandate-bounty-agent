// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { BountyVault, IERC20 } from "../src/BountyVault.sol";
import { MockUSDC } from "../src/MockUSDC.sol";

/// Deploys MockUSDC + BountyVault and records addresses in deployments/<chainId>.json.
/// Usage: forge script script/Deploy.s.sol --rpc-url sepolia --broadcast
contract Deploy is Script {
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(key);
        MockUSDC usdc = new MockUSDC();
        BountyVault vault = new BountyVault(IERC20(address(usdc)));
        vm.stopBroadcast();

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "deployBlock", block.number);
        vm.serializeAddress(obj, "mockUsdc", address(usdc));
        string memory json = vm.serializeAddress(obj, "bountyVault", address(vault));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));

        console.log("MockUSDC   ", address(usdc));
        console.log("BountyVault", address(vault));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { BountyVault, IERC20, IVerifyProofAggregation } from "../src/BountyVault.sol";
import { MockUSDC } from "../src/MockUSDC.sol";

/// Deploys MockUSDC + BountyVault and records addresses in deployments/<chainId>.json.
/// Env: DEPLOYER_PRIVATE_KEY, AGENT_ADDRESS (release signer), ZKVERIFY_AGGREGATION_ADDRESS,
/// ZKVERIFY_VK_HASH (mandate circuit vkHash from Kurier; 0x0 until registered),
/// ZKVERIFY_AGGREGATION_REQUIRED (true/false). Reuses MOCK_USDC_ADDRESS if set.
/// Usage: forge script script/Deploy.s.sol --rpc-url sepolia --broadcast
contract Deploy is Script {
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address agent = vm.envAddress("AGENT_ADDRESS");
        IVerifyProofAggregation zkVerify = IVerifyProofAggregation(vm.envAddress("ZKVERIFY_AGGREGATION_ADDRESS"));
        bytes32 vkHash = vm.envOr("ZKVERIFY_VK_HASH", bytes32(0));
        bool aggregationRequired = vm.envOr("ZKVERIFY_AGGREGATION_REQUIRED", true);
        address existingUsdc = vm.envOr("MOCK_USDC_ADDRESS", address(0));

        vm.startBroadcast(key);
        address usdc = existingUsdc != address(0) ? existingUsdc : address(new MockUSDC());
        BountyVault vault = new BountyVault(IERC20(usdc), agent, zkVerify, vkHash, aggregationRequired);
        vm.stopBroadcast();

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "deployBlock", block.number);
        vm.serializeAddress(obj, "mockUsdc", usdc);
        vm.serializeAddress(obj, "agent", agent);
        vm.serializeAddress(obj, "zkVerify", address(zkVerify));
        vm.serializeBool(obj, "aggregationRequired", aggregationRequired);
        string memory json = vm.serializeAddress(obj, "bountyVault", address(vault));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));

        console.log("MockUSDC   ", usdc);
        console.log("BountyVault", address(vault));
    }
}

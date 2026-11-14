// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { IVerifyProofAggregation } from "./BountyVault.sol";

/// Test and local-chain stand-in for zkVerify's aggregation contract: verifies only leaves that were
/// explicitly marked as aggregated, at the given (domainId, aggregationId).
contract MockZkVerify is IVerifyProofAggregation {
    mapping(bytes32 key => bool) public aggregated;

    function markAggregated(uint256 domainId, uint256 aggregationId, bytes32 leaf) external {
        aggregated[keccak256(abi.encode(domainId, aggregationId, leaf))] = true;
    }

    function verifyProofAggregation(uint256 domainId, uint256 aggregationId, bytes32 leaf, bytes32[] calldata, uint256, uint256)
        external
        view
        returns (bool)
    {
        return aggregated[keccak256(abi.encode(domainId, aggregationId, leaf))];
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEscrow} from "../interfaces/IEscrow.sol";
import {IDisputeResolver} from "../interfaces/IDisputeResolver.sol";

contract ResolverHarness is IDisputeResolver {
    function openDispute(uint256, address, address, address, uint256) external pure {}

    function resolve(address escrow, uint256 milestoneId, uint256 clientAward, uint256 freelancerAward) external {
        IEscrow(escrow).resolveDispute(milestoneId, clientAward, freelancerAward);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IDisputeResolver {
    function openDispute(
        uint256 milestoneId,
        address client,
        address freelancer,
        address arbiter,
        uint256 amount
    ) external;
}

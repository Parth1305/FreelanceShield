// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IEscrow {
    function resolveDispute(
        uint256 milestoneId,
        uint256 clientAward,
        uint256 freelancerAward
    ) external;
}

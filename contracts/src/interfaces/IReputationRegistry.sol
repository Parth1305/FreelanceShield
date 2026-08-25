// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IReputationRegistry {
    function recordContractResult(
        address client,
        address freelancer,
        bool disputed,
        address disputeWinner
    ) external;
}

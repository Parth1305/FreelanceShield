// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title FreelanceShield Reputation Registry
/// @notice Stores compact, outcome-based reputation facts reported by authorized escrow clones.
contract ReputationRegistry is Ownable {
    struct Reputation {
        uint32 completedContracts;
        uint32 disputesOpened;
        uint32 disputesWon;
        uint32 disputesLost;
    }

    mapping(address => Reputation) private reputations;
    mapping(address => bool) public registrars;
    mapping(address => bool) public authorizedReporters;

    error Unauthorized();
    error InvalidAddress();

    event RegistrarSet(address indexed registrar, bool authorized);
    event ReporterSet(address indexed reporter, bool authorized);
    event ContractResultRecorded(address indexed client, address indexed freelancer, bool disputed, address disputeWinner);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setRegistrar(address registrar, bool authorized) external onlyOwner {
        if (registrar == address(0)) revert InvalidAddress();
        registrars[registrar] = authorized;
        emit RegistrarSet(registrar, authorized);
    }

    function authorizeReporter(address reporter, bool authorized) external {
        if (msg.sender != owner() && !registrars[msg.sender]) revert Unauthorized();
        if (reporter == address(0)) revert InvalidAddress();
        authorizedReporters[reporter] = authorized;
        emit ReporterSet(reporter, authorized);
    }

    function recordContractResult(address client, address freelancer, bool disputed, address disputeWinner) external {
        if (!authorizedReporters[msg.sender]) revert Unauthorized();

        Reputation storage clientReputation = reputations[client];
        Reputation storage freelancerReputation = reputations[freelancer];
        clientReputation.completedContracts += 1;
        freelancerReputation.completedContracts += 1;

        if (disputed) {
            clientReputation.disputesOpened += 1;
            freelancerReputation.disputesOpened += 1;
            if (disputeWinner == client) {
                clientReputation.disputesWon += 1;
                freelancerReputation.disputesLost += 1;
            } else if (disputeWinner == freelancer) {
                freelancerReputation.disputesWon += 1;
                clientReputation.disputesLost += 1;
            }
        }

        emit ContractResultRecorded(client, freelancer, disputed, disputeWinner);
    }

    function getReputation(address account) external view returns (Reputation memory) {
        return reputations[account];
    }

    /// @notice Returns a deliberately simple 0-100 score derived only from settled on-chain facts.
    function scoreOf(address account) external view returns (uint256) {
        Reputation memory reputation = reputations[account];
        uint256 positive = 50 + uint256(reputation.completedContracts) * 5 + uint256(reputation.disputesWon) * 3;
        uint256 penalty = uint256(reputation.disputesLost) * 8;
        if (penalty >= positive) return 0;
        uint256 score = positive - penalty;
        return score > 100 ? 100 : score;
    }
}

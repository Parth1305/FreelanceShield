// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Escrow} from "./Escrow.sol";
import {DisputeResolver} from "./DisputeResolver.sol";
import {ReputationRegistry} from "./ReputationRegistry.sol";

/// @title FreelanceShield Escrow Factory
/// @notice Deploys one gas-efficient ERC-1167 escrow clone per freelance project.
contract EscrowFactory is Ownable {
    using Clones for address;

    address public immutable implementation;
    address public immutable disputeResolver;
    address public immutable reputationRegistry;
    address public feeRecipient;

    mapping(address => bool) public isEscrow;
    mapping(address => address[]) private clientEscrows;
    mapping(address => address[]) private freelancerEscrows;

    error InvalidAddress();

    event EscrowCreated(
        address indexed escrow,
        address indexed client,
        address indexed freelancer,
        address arbiter,
        uint256 feeAmount
    );
    event FeeRecipientUpdated(address indexed feeRecipient);

    constructor(
        address initialOwner,
        address implementation_,
        address disputeResolver_,
        address reputationRegistry_,
        address feeRecipient_
    ) Ownable(initialOwner) {
        if (
            implementation_ == address(0) || disputeResolver_ == address(0)
                || reputationRegistry_ == address(0) || feeRecipient_ == address(0)
        ) revert InvalidAddress();
        implementation = implementation_;
        disputeResolver = disputeResolver_;
        reputationRegistry = reputationRegistry_;
        feeRecipient = feeRecipient_;
    }

    /// @dev The clone is initialized and authorized in the same transaction. If any step fails, the
    /// entire creation reverts, so an externally visible uninitialized clone can never remain behind.
    function createEscrow(
        address client,
        address freelancer,
        address arbiter,
        uint256 feeAmount,
        uint256[] calldata milestoneAmounts
    ) external returns (address escrowAddress) {
        if (client == address(0) || freelancer == address(0) || arbiter == address(0)) revert InvalidAddress();

        escrowAddress = implementation.clone();
        Escrow(payable(escrowAddress)).initialize(
            address(this),
            client,
            freelancer,
            arbiter,
            feeRecipient,
            disputeResolver,
            reputationRegistry,
            feeAmount,
            milestoneAmounts
        );

        DisputeResolver(disputeResolver).authorizeEscrow(escrowAddress, true);
        ReputationRegistry(reputationRegistry).authorizeReporter(escrowAddress, true);
        isEscrow[escrowAddress] = true;
        clientEscrows[client].push(escrowAddress);
        freelancerEscrows[freelancer].push(escrowAddress);

        emit EscrowCreated(escrowAddress, client, freelancer, arbiter, feeAmount);
    }

    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        if (newFeeRecipient == address(0)) revert InvalidAddress();
        feeRecipient = newFeeRecipient;
        emit FeeRecipientUpdated(newFeeRecipient);
    }

    function getClientEscrows(address account) external view returns (address[] memory) {
        return clientEscrows[account];
    }

    function getFreelancerEscrows(address account) external view returns (address[] memory) {
        return freelancerEscrows[account];
    }
}

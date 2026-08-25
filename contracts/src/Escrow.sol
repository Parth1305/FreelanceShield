// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IDisputeResolver} from "./interfaces/IDisputeResolver.sol";
import {IReputationRegistry} from "./interfaces/IReputationRegistry.sol";

/// @title FreelanceShield Milestone Escrow
/// @notice Holds native ETH for one client/freelancer project and releases it milestone by milestone.
/// @dev Instances are ERC-1167 clones. The implementation disables initialization in its constructor;
/// each clone is initialized atomically by EscrowFactory.
contract Escrow is Initializable {
    enum MilestoneStatus {
        Pending,
        Submitted,
        Rejected,
        Disputed,
        Resolved
    }

    struct Milestone {
        uint256 amount;
        MilestoneStatus status;
        bytes32 deliverableHash;
    }

    address public factory;
    address public client;
    address public freelancer;
    address public arbiter;
    address public feeRecipient;
    IDisputeResolver public disputeResolver;
    IReputationRegistry public reputationRegistry;

    uint256 public platformFee;
    uint256 public totalMilestoneValue;
    uint256 public remainingMilestones;
    uint256 public clientDisputeAwards;
    uint256 public freelancerDisputeAwards;
    bool public funded;
    bool public completed;
    bool public hadDispute;

    Milestone[] private milestones;
    mapping(address => uint256) public withdrawable;
    uint256 private reentrancyStatus;

    error Unauthorized();
    error InvalidAddress();
    error InvalidMilestones();
    error InvalidAmount();
    error InvalidState();
    error AlreadyFunded();
    error NothingToWithdraw();
    error TransferFailed();
    error Reentrancy();

    event Funded(address indexed client, uint256 amount);
    event MilestoneSubmitted(uint256 indexed milestoneId, bytes32 deliverableHash);
    event MilestoneRejected(uint256 indexed milestoneId);
    event MilestoneReleased(uint256 indexed milestoneId, uint256 clientAward, uint256 freelancerAward);
    event DisputeRaised(uint256 indexed milestoneId, address indexed raisedBy);
    event Withdrawal(address indexed account, uint256 amount);
    event ProjectCompleted();

    modifier onlyClient() {
        if (msg.sender != client) revert Unauthorized();
        _;
    }

    modifier onlyFreelancer() {
        if (msg.sender != freelancer) revert Unauthorized();
        _;
    }

    modifier onlyParty() {
        if (msg.sender != client && msg.sender != freelancer) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (reentrancyStatus == 2) revert Reentrancy();
        reentrancyStatus = 2;
        _;
        reentrancyStatus = 1;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address factory_,
        address client_,
        address freelancer_,
        address arbiter_,
        address feeRecipient_,
        address disputeResolver_,
        address reputationRegistry_,
        uint256 feeAmount_,
        uint256[] calldata milestoneAmounts_
    ) external initializer {
        if (msg.sender != factory_) revert Unauthorized();
        if (
            client_ == address(0) || freelancer_ == address(0)
                || arbiter_ == address(0) || feeRecipient_ == address(0) || disputeResolver_ == address(0)
                || reputationRegistry_ == address(0)
        ) revert InvalidAddress();
        if (client_ == freelancer_ || milestoneAmounts_.length == 0) revert InvalidMilestones();

        factory = factory_;
        client = client_;
        freelancer = freelancer_;
        arbiter = arbiter_;
        feeRecipient = feeRecipient_;
        disputeResolver = IDisputeResolver(disputeResolver_);
        reputationRegistry = IReputationRegistry(reputationRegistry_);
        platformFee = feeAmount_;
        remainingMilestones = milestoneAmounts_.length;
        reentrancyStatus = 1;

        uint256 total;
        for (uint256 index = 0; index < milestoneAmounts_.length; index++) {
            uint256 amount = milestoneAmounts_[index];
            if (amount == 0) revert InvalidMilestones();
            total += amount;
            milestones.push(Milestone({amount: amount, status: MilestoneStatus.Pending, deliverableHash: bytes32(0)}));
        }
        totalMilestoneValue = total;
    }

    function requiredFunding() public view returns (uint256) {
        return totalMilestoneValue + platformFee;
    }

    function milestoneCount() external view returns (uint256) {
        return milestones.length;
    }

    function getMilestone(uint256 milestoneId) external view returns (Milestone memory) {
        if (milestoneId >= milestones.length) revert InvalidMilestones();
        return milestones[milestoneId];
    }

    function fund() external payable onlyClient {
        if (funded) revert AlreadyFunded();
        if (msg.value != requiredFunding()) revert InvalidAmount();
        funded = true;
        emit Funded(msg.sender, msg.value);
    }

    function submitMilestone(uint256 milestoneId, bytes32 deliverableHash) external onlyFreelancer {
        if (!funded || completed || deliverableHash == bytes32(0) || milestoneId >= milestones.length) {
            revert InvalidState();
        }
        Milestone storage milestone = milestones[milestoneId];
        if (milestone.status != MilestoneStatus.Pending && milestone.status != MilestoneStatus.Rejected) {
            revert InvalidState();
        }
        milestone.status = MilestoneStatus.Submitted;
        milestone.deliverableHash = deliverableHash;
        emit MilestoneSubmitted(milestoneId, deliverableHash);
    }

    /// @dev Approval credits the freelancer before any later withdrawal can transfer ETH. Separating
    /// accounting from transfer removes the recipient callback from the client's approval transaction.
    function approveMilestone(uint256 milestoneId) external onlyClient nonReentrant {
        if (milestoneId >= milestones.length) revert InvalidMilestones();
        Milestone storage milestone = milestones[milestoneId];
        if (!funded || completed || milestone.status != MilestoneStatus.Submitted) revert InvalidState();
        _settleMilestone(milestoneId, 0, milestone.amount);
    }

    function rejectMilestone(uint256 milestoneId) external onlyClient {
        if (milestoneId >= milestones.length) revert InvalidMilestones();
        Milestone storage milestone = milestones[milestoneId];
        if (!funded || completed || milestone.status != MilestoneStatus.Submitted) revert InvalidState();
        milestone.status = MilestoneStatus.Rejected;
        emit MilestoneRejected(milestoneId);
    }

    /// @dev The milestone enters Disputed before calling the resolver. A malicious resolver cannot
    /// reopen or mutate the same milestone during the handoff.
    function raiseDispute(uint256 milestoneId) external onlyParty nonReentrant {
        if (milestoneId >= milestones.length) revert InvalidMilestones();
        Milestone storage milestone = milestones[milestoneId];
        if (!funded || completed) revert InvalidState();
        if (milestone.status != MilestoneStatus.Submitted && milestone.status != MilestoneStatus.Rejected) {
            revert InvalidState();
        }

        milestone.status = MilestoneStatus.Disputed;
        hadDispute = true;
        disputeResolver.openDispute(milestoneId, client, freelancer, arbiter, milestone.amount);
        emit DisputeRaised(milestoneId, msg.sender);
    }

    function resolveDispute(uint256 milestoneId, uint256 clientAward, uint256 freelancerAward) external nonReentrant {
        if (msg.sender != address(disputeResolver)) revert Unauthorized();
        if (milestoneId >= milestones.length) revert InvalidMilestones();
        Milestone storage milestone = milestones[milestoneId];
        if (milestone.status != MilestoneStatus.Disputed) revert InvalidState();
        if (clientAward + freelancerAward != milestone.amount) revert InvalidAmount();

        clientDisputeAwards += clientAward;
        freelancerDisputeAwards += freelancerAward;
        _settleMilestone(milestoneId, clientAward, freelancerAward);
    }

    /// @notice Withdraw all ETH credited to the caller by approvals, refunds, or fees.
    /// @dev Checks-effects-interactions plus the lock prevent both same-function and cross-function
    /// reentrancy. A failed call reverts the whole transaction, restoring the caller's credit.
    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0;
        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();
        emit Withdrawal(msg.sender, amount);
    }

    function _settleMilestone(uint256 milestoneId, uint256 clientAward, uint256 freelancerAward) private {
        Milestone storage milestone = milestones[milestoneId];
        milestone.status = MilestoneStatus.Resolved;
        remainingMilestones -= 1;
        withdrawable[client] += clientAward;
        withdrawable[freelancer] += freelancerAward;
        emit MilestoneReleased(milestoneId, clientAward, freelancerAward);

        if (remainingMilestones == 0) {
            completed = true;
            withdrawable[feeRecipient] += platformFee;
            emit ProjectCompleted();
            _recordReputation();
        }
    }

    /// @dev Completion and the zero remaining-milestone count are committed before the trusted
    /// registry call, making this path naturally one-shot.
    function _recordReputation() private {
        address disputeWinner;
        if (clientDisputeAwards > freelancerDisputeAwards) disputeWinner = client;
        else if (freelancerDisputeAwards > clientDisputeAwards) disputeWinner = freelancer;
        reputationRegistry.recordContractResult(client, freelancer, hadDispute, disputeWinner);
    }
}

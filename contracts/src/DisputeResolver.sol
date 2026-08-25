// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IEscrow} from "./interfaces/IEscrow.sol";

/// @title FreelanceShield Dispute Resolver
/// @notice Routes each dispute to the arbiter selected by the project parties.
/// @dev A designated arbiter is intentionally used instead of token voting. For bilateral freelance
/// work, it avoids governance capture, voter apathy, and disclosure of private evidence to unrelated voters.
contract DisputeResolver is Ownable {
    struct Dispute {
        address escrow;
        address client;
        address freelancer;
        address arbiter;
        uint256 milestoneId;
        uint256 amount;
        uint256 clientAward;
        uint256 freelancerAward;
        bool open;
        bool resolved;
    }

    mapping(address => bool) public registrars;
    mapping(address => bool) public authorizedEscrows;
    mapping(bytes32 => Dispute) private disputes;

    error Unauthorized();
    error InvalidAddress();
    error InvalidAward();
    error DisputeAlreadyExists();
    error DisputeNotOpen();

    event RegistrarSet(address indexed registrar, bool authorized);
    event EscrowAuthorized(address indexed escrow, bool authorized);
    event DisputeOpened(bytes32 indexed disputeId, address indexed escrow, uint256 indexed milestoneId, address arbiter, uint256 amount);
    event DisputeResolved(bytes32 indexed disputeId, uint256 clientAward, uint256 freelancerAward);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setRegistrar(address registrar, bool authorized) external onlyOwner {
        if (registrar == address(0)) revert InvalidAddress();
        registrars[registrar] = authorized;
        emit RegistrarSet(registrar, authorized);
    }

    function authorizeEscrow(address escrow, bool authorized) external {
        if (msg.sender != owner() && !registrars[msg.sender]) revert Unauthorized();
        if (escrow == address(0)) revert InvalidAddress();
        authorizedEscrows[escrow] = authorized;
        emit EscrowAuthorized(escrow, authorized);
    }

    /// @dev Only factory-authorized escrows may create cases. This prevents fabricated cases from
    /// polluting the resolver state while still allowing the escrow to atomically hand off control.
    function openDispute(
        uint256 milestoneId,
        address client,
        address freelancer,
        address arbiter,
        uint256 amount
    ) external {
        if (!authorizedEscrows[msg.sender]) revert Unauthorized();
        if (client == address(0) || freelancer == address(0) || arbiter == address(0) || amount == 0) {
            revert InvalidAddress();
        }

        bytes32 disputeId = getDisputeId(msg.sender, milestoneId);
        if (disputes[disputeId].open || disputes[disputeId].resolved) revert DisputeAlreadyExists();

        disputes[disputeId] = Dispute({
            escrow: msg.sender,
            client: client,
            freelancer: freelancer,
            arbiter: arbiter,
            milestoneId: milestoneId,
            amount: amount,
            clientAward: 0,
            freelancerAward: 0,
            open: true,
            resolved: false
        });

        emit DisputeOpened(disputeId, msg.sender, milestoneId, arbiter, amount);
    }

    /// @notice Resolve a case with any split whose sum equals the disputed milestone amount.
    /// @dev The case is finalized before the escrow callback (checks-effects-interactions), so a
    /// malicious callback cannot resolve the same case twice.
    function resolve(bytes32 disputeId, uint256 clientAward, uint256 freelancerAward) external {
        Dispute storage dispute = disputes[disputeId];
        if (!dispute.open) revert DisputeNotOpen();
        if (msg.sender != dispute.arbiter) revert Unauthorized();
        if (clientAward + freelancerAward != dispute.amount) revert InvalidAward();

        dispute.open = false;
        dispute.resolved = true;
        dispute.clientAward = clientAward;
        dispute.freelancerAward = freelancerAward;

        IEscrow(dispute.escrow).resolveDispute(dispute.milestoneId, clientAward, freelancerAward);
        emit DisputeResolved(disputeId, clientAward, freelancerAward);
    }

    function getDispute(bytes32 disputeId) external view returns (Dispute memory) {
        return disputes[disputeId];
    }

    function getDisputeId(address escrow, uint256 milestoneId) public pure returns (bytes32) {
        return keccak256(abi.encode(escrow, milestoneId));
    }
}

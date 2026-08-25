// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IRejectingEscrow {
    function submitMilestone(uint256 milestoneId, bytes32 deliverableHash) external;
    function withdraw() external;
}

contract RejectingWithdrawer {
    IRejectingEscrow public escrow;

    function setEscrow(address escrow_) external {
        escrow = IRejectingEscrow(escrow_);
    }

    function submit(uint256 milestoneId, bytes32 deliverableHash) external {
        escrow.submitMilestone(milestoneId, deliverableHash);
    }

    function withdraw() external {
        escrow.withdraw();
    }

    receive() external payable {
        revert("reject ETH");
    }
}

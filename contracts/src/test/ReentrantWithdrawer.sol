// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IWithdrawEscrow {
    function withdraw() external;
    function submitMilestone(uint256 milestoneId, bytes32 deliverableHash) external;
}

/// @dev Test-only receiver that attempts to enter withdraw() a second time from receive().
contract ReentrantWithdrawer {
    IWithdrawEscrow public escrow;
    bool public attempted;
    bool public reentrySucceeded;

    function setEscrow(address escrow_) external {
        escrow = IWithdrawEscrow(escrow_);
    }

    function attack() external {
        escrow.withdraw();
    }

    function submit(uint256 milestoneId, bytes32 deliverableHash) external {
        escrow.submitMilestone(milestoneId, deliverableHash);
    }

    receive() external payable {
        attempted = true;
        (reentrySucceeded,) = address(escrow).call(abi.encodeWithSignature("withdraw()"));
    }
}

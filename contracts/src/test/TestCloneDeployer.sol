// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Escrow} from "../Escrow.sol";

contract TestCloneDeployer {
    using Clones for address;

    address public lastClone;

    function deployAndInitialize(
        address implementation,
        address claimedFactory,
        address client,
        address freelancer,
        address arbiter,
        address feeRecipient,
        address resolver,
        address registry,
        uint256 fee,
        uint256[] calldata amounts
    ) external returns (address clone) {
        clone = implementation.clone();
        lastClone = clone;
        Escrow(payable(clone)).initialize(
            claimedFactory,
            client,
            freelancer,
            arbiter,
            feeRecipient,
            resolver,
            registry,
            fee,
            amounts
        );
    }
}

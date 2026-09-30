// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script, console2} from "forge-std/Script.sol";
import {PooModuleDirectory} from "@poomeme/pons/PooModuleDirectory.sol";
import {__MODULE__Factory} from "../src/__MODULE__Factory.sol";

contract Publish is Script {
    // #region Running

    error NoDirectory();

    function run() external {
        address directoryAddress = vm.envAddress("DIRECTORY");
        if (directoryAddress == address(0)) revert NoDirectory();
        address factoryAddress = vm.envOr("FACTORY", address(0));
        bytes32 salt = vm.envOr("SALT", bytes32(0));
        PooModuleDirectory directory = PooModuleDirectory(directoryAddress);

        if (factoryAddress == address(0)) {
            bytes memory initcode =
                abi.encodePacked(type(__MODULE__Factory).creationCode, abi.encode(msg.sender, directory.launcher()));
            address predicted = directory.predictFactory(msg.sender, salt, keccak256(initcode));
            if (predicted.code.length != 0) {
                console2.log("already registered: __MODULE__Factory at", predicted);
                return;
            }
            vm.broadcast();
            (address deployed, uint256 entry) = directory.deployAndRegister(initcode, salt);
            console2.log("deployed __MODULE__Factory at", deployed);
            console2.log("registered as directory entry", entry);
            return;
        }

        vm.broadcast();
        uint256 index = directory.publish(factoryAddress);
        console2.log("registered as directory entry", index);
    }

    // #endregion
}

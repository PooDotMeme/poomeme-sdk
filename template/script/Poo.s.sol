// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script} from "forge-std/Script.sol";
import {LaunchRequest} from "@poomeme/pons/LaunchTypes.sol";
import {Devkit, DevkitHarness} from "@poo-devkit/ModuleHarness.sol";
import {__MODULE__Factory} from "../src/__MODULE__Factory.sol";

struct Graph {
    address deployer;
    address pons;
    address directory;
    address launcher;
    address moduleFactory;
    uint256 moduleEntry;
    address token;
    address splitter;
    address module;
}

abstract contract PooScript is Script {
    // #region Terms

    function moduleConfig() internal pure virtual returns (bytes memory) {
        return "";
    }

    function tokenName() internal pure virtual returns (string memory) {
        return "__MODULE__ Dev Token";
    }

    function tokenSymbol() internal pure virtual returns (string memory) {
        return "DEV";
    }

    // #endregion

    // #region Standing the devkit up

    function _stand(address deployer) internal returns (Graph memory g) {
        Devkit memory d = DevkitHarness.install(deployer, deployer, deployer);
        address factory;
        (factory, g.moduleEntry) = d.directory.deployAndRegister(_initcode(deployer, d), bytes32(0));

        LaunchRequest memory r = DevkitHarness.request(d, tokenName(), tokenSymbol(), 0, deployer);
        r = DevkitHarness.withModule(r, factory, 5_000, moduleConfig());
        r = DevkitHarness.vanity(d, deployer, r);

        uint256 fee = d.pons.launchFee();
        (address token, address splitter, address[] memory legs,) = d.launcher.launch{value: fee}(r);

        g.deployer = deployer;
        g.pons = address(d.pons);
        g.directory = address(d.directory);
        g.launcher = address(d.launcher);
        g.moduleFactory = factory;
        g.token = token;
        g.splitter = splitter;
        g.module = legs[0];
    }

    function _initcode(address developer, Devkit memory d) internal pure returns (bytes memory) {
        return abi.encodePacked(type(__MODULE__Factory).creationCode, abi.encode(developer, address(d.launcher)));
    }

    // #endregion
}

contract Dev is PooScript {
    // #region Running

    error NotALocalChain(uint256 chainId);

    function run() external returns (Graph memory graph, bytes memory encoded) {
        if (block.chainid != 31337 && block.chainid != 31338 && block.chainid != 31339) {
            revert NotALocalChain(block.chainid);
        }
        vm.startBroadcast();
        graph = _stand(msg.sender);
        vm.stopBroadcast();
        encoded = abi.encode(graph);
    }

    // #endregion
}

contract Preview is PooScript {
    // #region Running

    function run() external returns (bytes memory manifest, bool accepted, uint256 entryId, bytes memory refusal) {
        vm.startPrank(msg.sender);
        Devkit memory d = DevkitHarness.install(msg.sender, msg.sender, msg.sender);
        __MODULE__Factory factory = new __MODULE__Factory(msg.sender, address(d.launcher));
        manifest = abi.encode(factory.manifest());
        try d.directory.publish(address(factory)) returns (uint256 index) {
            accepted = true;
            entryId = index;
        } catch (bytes memory reason) {
            refusal = reason;
        }
        vm.stopPrank();
    }

    // #endregion
}

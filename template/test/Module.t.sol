// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {PonsLaunch} from "@poomeme/fees/IPons.sol";
import {IPooModuleFactory, ModuleContext} from "@poomeme/pons/IPooModuleFactory.sol";
import {LaunchRequest} from "@poomeme/pons/LaunchTypes.sol";
import {PooSplitter} from "@poomeme/pons/PooSplitter.sol";
import {PonsTestCurve} from "@core-test/pons/PonsMocks.sol";
import {Devkit, DevkitHarness} from "@poo-devkit/ModuleHarness.sol";
import {__MODULE__} from "../src/__MODULE__.sol";
import {__MODULE__Factory} from "../src/__MODULE__Factory.sol";

contract __MODULE__Test is Test {
    // #region Fixture

    address internal immutable DEVELOPER = makeAddr("developer");
    address internal immutable CREATOR = makeAddr("creator");
    address internal immutable PLATFORM = makeAddr("platform treasury");
    address internal immutable PROTOCOL = makeAddr("pons protocol");
    address internal immutable BUYBACK_VAULT = makeAddr("pons buyback vault");
    address internal immutable BUYER = makeAddr("buyer");

    Devkit internal devkit;
    __MODULE__Factory internal factory;

    function setUp() public {
        devkit = DevkitHarness.install(PROTOCOL, BUYBACK_VAULT, PLATFORM);
        bytes memory initcode =
            abi.encodePacked(type(__MODULE__Factory).creationCode, abi.encode(DEVELOPER, address(devkit.launcher)));
        vm.prank(DEVELOPER);
        (address deployed,) = devkit.directory.deployAndRegister(initcode, bytes32(0));
        factory = __MODULE__Factory(deployed);
    }

    // #endregion

    // #region Publishing

    function test_theDirectoryRegistersThisFactory() public view {
        assertTrue(devkit.directory.isRegistered(address(factory)));
        assertTrue(devkit.directory.matchesPublished(address(factory)));
        assertTrue(devkit.launcher.isInstallable(address(factory)));
    }

    function test_onlyTheLauncherMayCreate() public {
        ModuleContext memory context;
        vm.expectRevert(IPooModuleFactory.NotLauncher.selector);
        factory.create(context, "");
    }

    function test_theManifestNamesItsOwnHandle() public view {
        assertEq(factory.manifest().handle, "__HANDLE__");
    }

    // #endregion

    // #region Launch

    function test_aTokenCanInstallThisModuleAsAFeeLegAndPayIt() public {
        LaunchRequest memory r = DevkitHarness.request(devkit, "Fixture", "FIX", 500, CREATOR);
        r = DevkitHarness.withModule(r, address(factory), 5_000, "");
        r = DevkitHarness.vanity(devkit, CREATOR, r);

        uint256 fee = devkit.pons.launchFee();
        vm.deal(CREATOR, fee);
        vm.prank(CREATOR);
        (address token, address splitterAddress, address[] memory legs,) = devkit.launcher.launch{value: fee}(r);

        __MODULE__ module = __MODULE__(payable(legs[0]));
        assertEq(module.token(), token);
        assertEq(module.beneficiary(), DEVELOPER);

        PonsLaunch memory launch = devkit.pons.getLaunchedToken(token);
        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        PonsTestCurve(payable(launch.curve)).buy{value: 1 ether}(1 ether, 0, BUYER);

        PooSplitter splitter = PooSplitter(payable(splitterAddress));
        splitter.collect();
        assertGt(module.held(), 0);

        uint256 before = DEVELOPER.balance;
        module.release();
        assertGt(DEVELOPER.balance, before);
    }

    function test_aCreatorCanNameADifferentBeneficiary() public {
        LaunchRequest memory r = DevkitHarness.request(devkit, "Fixture", "FIX", 0, CREATOR);
        address chosen = makeAddr("chosen beneficiary");
        r = DevkitHarness.withModule(r, address(factory), 5_000, abi.encode(chosen));
        r = DevkitHarness.vanity(devkit, CREATOR, r);

        uint256 fee = devkit.pons.launchFee();
        vm.deal(CREATOR, fee);
        vm.prank(CREATOR);
        (,, address[] memory legs,) = devkit.launcher.launch{value: fee}(r);

        assertEq(__MODULE__(payable(legs[0])).beneficiary(), chosen);
    }

    // #endregion
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
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
    address internal immutable STRANGER = makeAddr("stranger");

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

    function _create(address token, bytes memory config) internal returns (__MODULE__) {
        ModuleContext memory context;
        context.token = token;
        context.splitter = makeAddr("splitter");
        context.bps = 5_000;
        vm.prank(address(devkit.launcher));
        return __MODULE__(payable(factory.create(context, config)));
    }

    function _refusedAsNotAClone(address target, bytes memory data) internal {
        vm.prank(STRANGER);
        (bool ok, bytes memory reason) = target.call(data);
        assertFalse(ok);
        assertEq(reason, abi.encodeWithSelector(__MODULE__.NotAClone.selector));
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
        vm.prank(DEVELOPER);
        vm.expectRevert(IPooModuleFactory.NotLauncher.selector);
        factory.create(context, hex"01");
    }

    function test_theManifestNamesItsOwnHandle() public view {
        assertEq(factory.manifest().handle, "__HANDLE__");
    }

    // #endregion

    // #region Clone

    function test_aCreatedModuleIsTheMinimalProxyWithArgsOfTheImplementation() public {
        address token = makeAddr("token");
        address implementation = address(factory.implementation());
        address predicted = vm.computeCreateAddress(address(factory), vm.getNonce(address(factory)));
        address splitter = makeAddr("splitter");
        bytes memory args = abi.encode(token, DEVELOPER);

        vm.expectEmit(address(factory));
        emit __MODULE__Factory.ModuleCreated(token, predicted, address(devkit.launcher), splitter, 5_000);
        __MODULE__ module = _create(token, "");

        assertEq(address(module), predicted);
        assertEq(
            address(module).code,
            abi.encodePacked(hex"363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3", args)
        );
        assertEq(Clones.fetchCloneArgs(address(module)), args);
        assertGt(implementation.code.length, address(module).code.length);
        assertEq(implementation, vm.computeCreateAddress(address(factory), 1));
    }

    function test_twoModulesFromOneFactoryKeepTheirOwnArgsAndState() public {
        address chosen = makeAddr("chosen beneficiary");
        __MODULE__ a = _create(makeAddr("token a"), "");
        __MODULE__ b = _create(makeAddr("token b"), abi.encode(chosen));
        address implementation = address(factory.implementation());
        bytes memory codeA = address(a).code;
        bytes memory codeB = address(b).code;
        address pointedA;
        address pointedB;
        assembly ("memory-safe") {
            pointedA := shr(96, mload(add(codeA, 0x2a)))
            pointedB := shr(96, mload(add(codeB, 0x2a)))
        }
        assertEq(pointedA, implementation);
        assertEq(pointedB, implementation);

        assertEq(a.token(), makeAddr("token a"));
        assertEq(b.token(), makeAddr("token b"));
        assertEq(a.beneficiary(), DEVELOPER);
        assertEq(b.beneficiary(), chosen);

        vm.deal(BUYER, 3 ether);
        vm.prank(BUYER);
        (bool toA,) = address(a).call{value: 1 ether}("");
        vm.prank(BUYER);
        (bool toB,) = address(b).call{value: 2 ether}("");
        assertTrue(toA && toB);
        assertEq(a.held(), 1 ether);
        assertEq(b.held(), 2 ether);

        uint256 developerBefore = DEVELOPER.balance;
        vm.expectEmit(address(b));
        emit __MODULE__.Released(chosen, 2 ether);
        assertEq(b.release(), 2 ether);
        assertEq(chosen.balance, 2 ether);
        assertEq(b.held(), 0);
        assertEq(a.held(), 1 ether);
        assertEq(DEVELOPER.balance, developerBefore);
        vm.expectRevert(__MODULE__.NothingToRelease.selector);
        b.release();

        assertEq(a.release(), 1 ether);
        assertEq(DEVELOPER.balance, developerBefore + 1 ether);
        assertEq(chosen.balance, 2 ether);
    }

    function test_theImplementationCalledDirectlyIsInert() public {
        address implementation = address(factory.implementation());
        _refusedAsNotAClone(implementation, abi.encodeCall(__MODULE__.token, ()));
        _refusedAsNotAClone(implementation, abi.encodeCall(__MODULE__.beneficiary, ()));
        _refusedAsNotAClone(implementation, abi.encodeCall(__MODULE__.held, ()));
        _refusedAsNotAClone(implementation, abi.encodeCall(__MODULE__.release, ()));
        vm.deal(STRANGER, 1 ether);
        vm.prank(STRANGER);
        (bool sent, bytes memory reason) = implementation.call{value: 1 ether}("");
        assertFalse(sent);
        assertEq(reason, abi.encodeWithSelector(__MODULE__.NotAClone.selector));
        assertEq(implementation.balance, 0);
        assertEq(STRANGER.balance, 1 ether);
    }

    function test_aCloneWithoutExactlyTheModulesArgsIsInertToo() public {
        address implementation = address(factory.implementation());
        bytes[3] memory argSets = [
            bytes(""),
            abi.encode(makeAddr("token"), DEVELOPER, uint256(0)),
            abi.encode(makeAddr("token"))
        ];
        for (uint256 i; i < argSets.length; ++i) {
            address stray = Clones.cloneWithImmutableArgs(implementation, argSets[i]);
            vm.deal(address(this), 1 ether);
            (bool sent, bytes memory reason) = stray.call{value: 1 ether}("");
            assertFalse(sent);
            assertEq(reason, abi.encodeWithSelector(__MODULE__.NotAClone.selector));
            _refusedAsNotAClone(stray, abi.encodeCall(__MODULE__.release, ()));
            _refusedAsNotAClone(stray, abi.encodeCall(__MODULE__.beneficiary, ()));
        }
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
        assertEq(Clones.fetchCloneArgs(address(module)), abi.encode(token, DEVELOPER));

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

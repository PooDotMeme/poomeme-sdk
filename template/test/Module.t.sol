// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {Platform, PlatformHarness, PlatformTerms} from "@poo/devkit/PlatformHarness.sol";
import {MockERC20} from "@poo/devkit/mocks/MockERC20.sol";
import {QuoteKind} from "@standard/ManifestTypes.sol";
import {IPooTokenModuleFactory} from "@token-module/IPooTokenModuleFactory.sol";
import {TokenModuleContext} from "@token-module/TokenModuleTypes.sol";
import {__MODULE__} from "@modules/__MODULE__.sol";
import {__MODULE__Factory} from "@modules/__MODULE__Factory.sol";

contract __MODULE__Test is Test {
    // #region Platform

    bytes32 internal constant V2_PAIR_INIT_CODE_HASH =
        0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f;

    Platform internal platform;
    MockERC20 internal quote;
    __MODULE__Factory internal factory;

    function setUp() public {
        quote = new MockERC20("Quote", "QUO", 18);
        platform = PlatformHarness.install(
            PlatformTerms({
                owner: address(this),
                quote: address(quote),
                quoteKind: QuoteKind.Stable,
                platformShareBps: 10,
                feeRecipient: address(0xFEE),
                pairInitCodeHash: V2_PAIR_INIT_CODE_HASH,
                txGasCap: 16_777_216
            })
        );
        factory = new __MODULE__Factory(address(platform.moduleRegistry));
    }

    // #endregion

    // #region Publishing

    function test_theRegistryAcceptsThisModule() public {
        uint32 entryId = platform.moduleRegistry.publishTokenModule(IPooTokenModuleFactory(address(factory)));
        assertGt(entryId, 0, "the registry refused the manifest");
    }

    // #endregion

    // #region Behaviour

    function test_aStreakStartsWhenTheBalanceCrosses() public {
        __MODULE__ module = _standalone(100e18);
        module.track(address(0xA), address(0xB), 0, 100e18);
        assertEq(module.streakOf(address(0xB)), 0);
        skip(1 days);
        assertEq(module.streakOf(address(0xB)), 1 days);
    }

    function test_aStreakEndsWhenTheBalanceFalls() public {
        __MODULE__ module = _standalone(100e18);
        module.track(address(0xA), address(0xB), 0, 100e18);
        skip(1 days);
        module.track(address(0xB), address(0xC), 99e18, 1e18);
        assertEq(module.streakOf(address(0xB)), 0);
    }

    function test_onlyTheTokenReportsTransfers() public {
        __MODULE__ module = _standalone(100e18);
        vm.prank(address(0xBAD));
        vm.expectRevert();
        module.track(address(0xA), address(0xB), 0, 100e18);
    }

    function _standalone(uint256 threshold) private returns (__MODULE__ module) {
        module = new __MODULE__();
        module.initialize(
            TokenModuleContext({
                token: address(this), quote: address(quote), pair: address(quote), router: address(quote)
            }),
            abi.encode(threshold)
        );
    }

    // #endregion
}

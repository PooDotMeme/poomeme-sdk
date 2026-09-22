// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV2Router02} from "@uniswap/v2-periphery/interfaces/IUniswapV2Router02.sol";
import {
    CanonicalV2,
    CanonicalV2Install,
    Platform,
    PlatformHarness,
    PlatformTerms
} from "@poo/devkit/PlatformHarness.sol";
import {ConformanceLaunchFixtureFactory} from "@poo/devkit/mocks/ConformanceLaunchFixtureFactory.sol";
import {MockERC20} from "@poo/devkit/mocks/MockERC20.sol";
import {TokenSaltLib} from "@poo/devkit/TokenSaltLib.sol";
import {LaunchContext} from "@launch/mode/IPooLaunchMode.sol";
import {IPooToken} from "@standard/IPooToken.sol";
import {QuoteKind} from "@standard/ManifestTypes.sol";
import {IPooTokenModuleFactory} from "@standard/token-module/IPooTokenModuleFactory.sol";
import {TokenModuleBinding} from "@standard/token-module/TokenModuleTypes.sol";
import {Metadata} from "@platform/PooMetadata.sol";
import {CreatorTaxTerms, TokenModuleChoice, TokenTerms} from "@token/PooTokenFactory.sol";
import {__MODULE__Factory} from "@modules/__MODULE__Factory.sol";

struct Graph {
    address deployer;
    address quote;
    address v2Factory;
    address v2Router;
    address weth;
    address venueRegistry;
    address moduleRegistry;
    address tokenFactory;
    address metadata;
    address blueprint;
    address launchFactory;
    address launch;
    address moduleFactory;
    uint32 moduleEntry;
    address token;
    address module;
}

abstract contract PooScript is Script {
    // #region Terms

    bytes32 internal constant V2_PAIR_INIT_CODE_HASH =
        0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f;
    uint256 internal constant TX_GAS_CAP = 16_777_216;
    uint16 internal constant PLATFORM_SHARE_BPS = 10;
    uint256 internal constant TOTAL_SUPPLY = 1_000_000e18;
    uint8 internal constant QUOTE_DECIMALS = 18;
    uint8 internal constant TAX_PAYEE_CAP = 8;

    function terms(address deployer, address quote, address launchFactory)
        internal
        pure
        virtual
        returns (PlatformTerms memory)
    {
        return PlatformTerms({
            owner: deployer,
            quote: quote,
            quoteKind: QuoteKind.Token,
            platformShareBps: PLATFORM_SHARE_BPS,
            feeRecipient: deployer,
            launchFactory: launchFactory,
            pairInitCodeHash: V2_PAIR_INIT_CODE_HASH,
            txGasCap: TX_GAS_CAP
        });
    }

    function moduleConfig() internal pure virtual returns (bytes memory) {
        return abi.encode(uint256(100e18));
    }

    function tokenTerms(Platform memory p, address quote) internal pure virtual returns (TokenTerms memory) {
        return TokenTerms({
            name: "__MODULE__ Dev Token",
            symbol: "DEV",
            decimals: 18,
            totalSupply: TOTAL_SUPPLY,
            venueId: p.venueId,
            quote: quote,
            salt: bytes32(0)
        });
    }

    // #endregion

    // #region Standing the platform up

    function _stand(address deployer) internal returns (Graph memory g) {
        g.deployer = deployer;
        g.quote = address(new MockERC20("Dev Quote", "DQ", QUOTE_DECIMALS));
        g.v2Factory = CanonicalV2.FACTORY;
        g.v2Router = CanonicalV2.ROUTER;
        g.weth = CanonicalV2.WETH;
        g.launchFactory = address(new ConformanceLaunchFixtureFactory());

        Platform memory p = PlatformHarness.install(terms(deployer, g.quote, g.launchFactory));
        g.venueRegistry = address(p.registry);
        g.moduleRegistry = address(p.moduleRegistry);
        g.tokenFactory = address(p.tokenFactory);
        g.metadata = address(p.metadata);
        g.blueprint = address(p.blueprint);

        g.moduleFactory = address(new __MODULE__Factory(g.moduleRegistry));
        g.moduleEntry = p.moduleRegistry.publishTokenModule(IPooTokenModuleFactory(g.moduleFactory));

        g.token = _createToken(p, g);
        g.launch = _bindLaunch(p, g);
        TokenModuleBinding[] memory table = IPooToken(g.token).tokenModules();
        g.module = table[0].module;
    }

    function _createToken(Platform memory p, Graph memory g) private returns (address) {
        (, bytes32 signedBlueprint) = p.tokenFactory.blueprint();

        TokenModuleChoice[] memory chosen = new TokenModuleChoice[](1);
        chosen[0] =
            TokenModuleChoice({entryId: g.moduleEntry, supply: 0, config: moduleConfig(), buyBps: 0, sellBps: 0});

        CreatorTaxTerms memory tax;
        tax.payeeCap = TAX_PAYEE_CAP;

        // Every POO.MEME token's address ends 8888 and the factory refuses one
        // that does not, so the salt is searched rather than chosen. The seed
        // is whatever `tokenTerms` returned, so overriding it still decides
        // where the search starts.
        TokenTerms memory chosenTerms = tokenTerms(p, g.quote);
        chosenTerms.salt = TokenSaltLib.mine(p.tokenFactory, msg.sender, chosenTerms.salt);

        return p.tokenFactory
            .create(chosenTerms, Metadata({description: "", website: "", x: "", telegram: "", whitelistUrl: ""}), chosen, tax, signedBlueprint);
    }

    function _bindLaunch(Platform memory p, Graph memory g) private returns (address launch) {
        IUniswapV2Router02 bound = IUniswapV2Router02(IPooToken(g.token).router());
        LaunchContext memory ctx;
        ctx.token = g.token;
        ctx.quote = IPooToken(g.token).quote();
        ctx.pair = IPooToken(g.token).pair();
        ctx.dexFactory = bound.factory();
        ctx.initialAuthority = g.deployer;
        ctx.launchSupply = TOTAL_SUPPLY;
        ctx.nativeIngress = ctx.quote == bound.WETH();
        (,, ctx.pushGas) = p.tokenFactory.quoteAllowance(ctx.nativeIngress ? address(0) : ctx.quote);

        launch = ConformanceLaunchFixtureFactory(g.launchFactory).create(ctx, "");
        IPooToken(g.token).setLaunch(launch);
        IERC20(g.token).transfer(launch, TOTAL_SUPPLY);
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
        _installCanonicalV2();
        vm.startBroadcast();
        graph = _stand(msg.sender);
        vm.stopBroadcast();
        encoded = abi.encode(graph);
    }

    // #endregion

    // #region Uniswap V2 at its canonical addresses

    function _installCanonicalV2() private {
        CanonicalV2Install.install();
        _setCode(CanonicalV2.FACTORY, CanonicalV2.factoryRuntime());
        _setCode(CanonicalV2.ROUTER, CanonicalV2.routerRuntime());
        _setCode(CanonicalV2.WETH, CanonicalV2.wethRuntime());
        _setStorage(CanonicalV2.FACTORY, bytes32(uint256(1)), bytes32(uint256(uint160(address(0xFEE70)))));
        _setStorage(
            CanonicalV2.WETH, bytes32(uint256(0)), 0x577261707065642045746865720000000000000000000000000000000000001a
        );
        _setStorage(
            CanonicalV2.WETH, bytes32(uint256(1)), 0x5745544800000000000000000000000000000000000000000000000000000008
        );
        _setStorage(CanonicalV2.WETH, bytes32(uint256(2)), bytes32(uint256(18)));
    }

    function _setCode(address target, bytes memory runtime) private {
        vm.rpc("anvil_setCode", string.concat('["', vm.toString(target), '","', vm.toString(runtime), '"]'));
    }

    function _setStorage(address target, bytes32 slot, bytes32 value) private {
        vm.rpc(
            "anvil_setStorageAt",
            string.concat('["', vm.toString(target), '","', vm.toString(slot), '","', vm.toString(value), '"]')
        );
    }

    // #endregion
}

contract Preview is PooScript {
    // #region Running

    function run() external returns (bytes memory manifest, bool accepted, uint32 entryId, bytes memory refusal) {
        vm.startPrank(msg.sender);
        address quote = address(new MockERC20("Preview Quote", "PQ", QUOTE_DECIMALS));
        address launchFactory = address(new ConformanceLaunchFixtureFactory());
        Platform memory p = PlatformHarness.install(terms(msg.sender, quote, launchFactory));
        __MODULE__Factory factory = new __MODULE__Factory(address(p.moduleRegistry));
        manifest = abi.encode(factory.manifest());
        try p.moduleRegistry.publishTokenModule(IPooTokenModuleFactory(address(factory))) returns (uint32 id) {
            accepted = true;
            entryId = id;
        } catch (bytes memory reason) {
            refusal = reason;
        }
        vm.stopPrank();
    }

    // #endregion
}

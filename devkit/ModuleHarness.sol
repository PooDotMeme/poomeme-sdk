// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Vm, VmSafe} from "forge-std/Vm.sol";
import {IPonsFactory} from "@poomeme/fees/IPons.sol";
import {IUniswapV3Factory} from "@poomeme/fees/IUniswapV3.sol";
import {PooRefundPricer} from "@poomeme/fees/PooRefundPricer.sol";
import {LaunchRequest, ModuleShare, PayoutShare} from "@poomeme/pons/LaunchTypes.sol";
import {PooLauncher} from "@poomeme/pons/PooLauncher.sol";
import {PooModuleDirectory} from "@poomeme/pons/PooModuleDirectory.sol";
import {PonsV2TestFactory} from "@core-test/pons/PonsV2Mocks.sol";
import {SpawnWork, VanityMinerLib} from "@core-test/pons/VanityMinerLib.sol";

// #region Devkit

struct Devkit {
    PonsV2TestFactory pons;
    PooModuleDirectory directory;
    PooLauncher launcher;
}

library DevkitHarness {
    uint256 internal constant MINING_BOUND = 2_000_000;
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function install(address protocolRecipient, address buybackVault, address platformTreasury)
        internal
        returns (Devkit memory d)
    {
        d.pons = new PonsV2TestFactory(protocolRecipient, buybackVault);
        PooRefundPricer pricer = new PooRefundPricer(
            IUniswapV3Factory(_standIn("devkit.uniswap-v3")), _standIn("devkit.weth"), _standIn("devkit.usd")
        );
        address deployer = _deployer();
        d.directory = new PooModuleDirectory(VM.computeCreateAddress(deployer, VM.getNonce(deployer) + 1));
        d.launcher = new PooLauncher(IPonsFactory(address(d.pons)), 0, platformTreasury, d.directory, pricer);
    }

    function _standIn(string memory label) private pure returns (address) {
        return address(uint160(uint256(keccak256(bytes(label)))));
    }

    function _deployer() private view returns (address) {
        (VmSafe.CallerMode mode, address sender,) = VM.readCallers();
        return mode == VmSafe.CallerMode.None ? address(this) : sender;
    }

    function request(Devkit memory d, string memory name, string memory symbol, uint16 creatorTaxBps, address payout)
        internal
        view
        returns (LaunchRequest memory r)
    {
        r.name = name;
        r.symbol = symbol;
        r.image = "ipfs://devkit";
        r.description = "A token launched by the poo-sdk devkit";
        r.website = "https://poo.meme";
        r.creatorTaxBps = creatorTaxBps;
        r.modules = new ModuleShare[](0);
        r.payouts = new PayoutShare[](0);
        r.payout = payout;
        r.owner = payout;
        r.expectedEconomics = d.pons.previewLaunchEconomics(0, address(0));
    }

    function withModule(LaunchRequest memory r, address factory, uint16 bps, bytes memory config)
        internal
        pure
        returns (LaunchRequest memory)
    {
        ModuleShare[] memory modules = new ModuleShare[](r.modules.length + 1);
        for (uint256 i; i < r.modules.length; ++i) {
            modules[i] = r.modules[i];
        }
        modules[r.modules.length] = ModuleShare({factory: factory, bps: bps, config: config});
        r.modules = modules;
        return r;
    }

    // PooLauncher refuses any launch whose predicted token address does not
    // end 0x8888 (NotVanity) — mines a salt that lands there, the same way
    // contracts/test/pons/LaunchFixture.sol's own fixture does, against
    // the same vendored VanityMinerLib.
    function vanity(Devkit memory d, address sender, LaunchRequest memory r)
        internal
        view
        returns (LaunchRequest memory)
    {
        (bytes32 salt,) = VanityMinerLib.mineSpawned(
            SpawnWork({
                launcher: address(d.launcher),
                pons: address(d.pons),
                spawnerCodeHash: d.pons.spawnerCodeHash(),
                sender: sender,
                seed: keccak256(abi.encode(sender, r.name, r.symbol, r.creatorTaxBps, r.modules.length))
            }),
            MINING_BOUND
        );
        r.salt = salt;
        return r;
    }
}

// #endregion

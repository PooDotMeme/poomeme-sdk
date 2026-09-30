// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IPooModuleFactory, ModuleContext} from "@poomeme/pons/IPooModuleFactory.sol";
import {ModuleManifestLib} from "@poomeme/pons/ModuleManifestLib.sol";
import {
    Action,
    ActionFlow,
    ErrorText,
    EventDecl,
    Field,
    ListDecl,
    ModuleManifest,
    NO_EVENT_ARG,
    Section,
    SectionRole,
    Tone,
    Unit,
    View,
    Widget
} from "@poomeme/pons/ModuleManifestTypes.sol";
import {__MODULE__} from "./__MODULE__.sol";

contract __MODULE__Factory is IPooModuleFactory {
    // #region Instances

    address public immutable developer;
    address public immutable launcher;

    event ModuleCreated(
        address indexed token, address indexed module, address indexed launcher, address splitter, uint16 bps
    );

    error ZeroAddress();

    constructor(address developer_, address launcher_) {
        if (developer_ == address(0) || launcher_ == address(0)) revert ZeroAddress();
        developer = developer_;
        launcher = launcher_;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IPooModuleFactory).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function create(ModuleContext calldata context, bytes calldata config) external returns (address module) {
        if (msg.sender != launcher) revert NotLauncher();
        address beneficiary = config.length == 0 ? developer : abi.decode(config, (address));
        module = address(new __MODULE__(context.token, beneficiary));
        emit ModuleCreated(context.token, module, msg.sender, context.splitter, context.bps);
    }

    // #endregion

    // #region Manifest

    function manifest() external pure returns (ModuleManifest memory m) {
        m = ModuleManifestLib.base(
            "__MODULE__",
            "__HANDLE__",
            "0.1.0",
            "Holds its share of the fees until anyone releases it to a fixed beneficiary",
            "The share of this token's fees the creator routed here sits in this module until release is called. Anyone may call it; the ETH always goes to the beneficiary the creator set when the token launched, and to nobody else."
        );
        m.config = _configFields();
        m.sections = new Section[](1);
        m.sections[0] = _vaultSection();
        m.events = _events();
        m.errors = _errors();
    }

    function _configFields() private pure returns (Field[] memory f) {
        f = new Field[](1);
        f[0].name = "beneficiary";
        f[0].abiType = "address";
        f[0].label = "Beneficiary";
        f[0].unit = Unit.Address;
        f[0].help = "Who release() pays. Defaults to the module's developer if left blank.";
        f[0].optional = true;
        f[0].options = new string[](0);
        f[0].presetBps = new uint16[](0);
    }

    function _vaultSection() private pure returns (Section memory s) {
        s.title = "Vault";
        s.role = SectionRole.Body;
        s.columns = 1;
        s.views = new View[](1);
        s.views[0] =
            ModuleManifestLib.figure(Widget.Figure, "Held", __MODULE__.held.selector, false, Unit.QuoteAmount, false);
        s.actions = new Action[](1);
        s.actions[0] = ModuleManifestLib.call(
            "release",
            "Send what is held to the beneficiary",
            __MODULE__.release.selector,
            ActionFlow.None,
            ModuleManifestLib.none(),
            ModuleManifestLib.when(bytes4(0), false, "")
        );
        s.lists = new ListDecl[](0);
        s.items = ModuleManifestLib.items(1, 1);
    }

    function _events() private pure returns (EventDecl[] memory e) {
        e = new EventDecl[](1);
        e[0] = ModuleManifestLib.logged(
            __MODULE__.Released.selector,
            "Released(address indexed to, uint256 amount)",
            0,
            1,
            Unit.QuoteAmount,
            Tone.Positive,
            "Released"
        );
    }

    function _errors() private pure returns (ErrorText[] memory e) {
        e = new ErrorText[](1);
        e[0] = ErrorText({selector: __MODULE__.NothingToRelease.selector, text: "Nothing is held"});
    }

    // #endregion
}

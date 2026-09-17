// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IPooProbeHost} from "@standard/IPooProbeHost.sol";
import {ManifestFieldsLib} from "@standard/ManifestFieldsLib.sol";
import {
    Action,
    ActionFlow,
    ErrorText,
    EventDecl,
    EventRole,
    Field,
    Item,
    ItemKind,
    ListDecl,
    Manifest,
    NO_EVENT_ARG,
    QuoteKind,
    Requires,
    Section,
    Seed,
    TaxAsset,
    Tone,
    Unit,
    View,
    Widget
} from "@standard/ManifestTypes.sol";
import {NotAContract} from "@standard/PooErrors.sol";
import {IPooTokenModuleFactory} from "@token-module/IPooTokenModuleFactory.sol";
import {TokenModuleContext} from "@token-module/TokenModuleTypes.sol";
import {__MODULE__} from "@modules/__MODULE__.sol";

contract __MODULE__Factory is IPooTokenModuleFactory {
    // #region Shared

    uint32 private constant TRACK_GAS = 90_000;
    uint256 private constant PROBE_THRESHOLD = 1;

    address public immutable override probe;
    address public immutable developer;

    constructor(address moduleRegistry) {
        if (moduleRegistry.code.length == 0) revert NotAContract(moduleRegistry);
        developer = msg.sender;
        address standIn = IPooProbeHost(moduleRegistry).probeStandIn();
        probe = _spawn(
            TokenModuleContext({token: standIn, quote: standIn, pair: standIn, router: standIn}), _probeConfig()
        );
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IPooTokenModuleFactory).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // #endregion

    // #region Instances

    function create(TokenModuleContext calldata ctx, bytes calldata config)
        external
        override
        returns (address tokenModule)
    {
        tokenModule = _spawn(ctx, config);
    }

    function _spawn(TokenModuleContext memory ctx, bytes memory config) private returns (address tokenModule) {
        tokenModule = address(new __MODULE__());
        __MODULE__(tokenModule).initialize(ctx, config);
    }

    // #endregion

    // #region Manifest

    function manifest() external pure override returns (Manifest memory m) {
        m.name = "__MODULE__";
        m.summary = "Counts how long a wallet has held at least the balance its creator set";
        m.description =
            "Every transfer the token writes is reported here. A wallet whose balance reaches the threshold starts a streak, and a wallet that falls below it loses one. Nothing is held, nothing is paid out, and this module can neither stop a trade nor move your tokens.";
        m.handle = "__HANDLE__";
        m.requires = Requires({
            quote: QuoteKind.Any,
            minTotalBps: 0,
            unique: true,
            minSupplyBps: 0,
            taxAsset: TaxAsset.None,
            acceptsSupply: false
        });
        m.seeds = new Seed[](0);
        m.trackGas = TRACK_GAS;
        m.probeConfig = _probeConfig();
        m.config = _configFields();
        m.sections = new Section[](1);
        m.sections[0] = _streakSection();
        m.events = _events();
        m.errors = new ErrorText[](0);
    }

    function _probeConfig() private pure returns (bytes memory) {
        return abi.encode(PROBE_THRESHOLD);
    }

    function _configFields() private pure returns (Field[] memory f) {
        f = new Field[](1);
        f[0] = ManifestFieldsLib.field(
            "threshold", "uint256", "Minimum balance", Unit.TokenAmount, "What a wallet must hold for its streak to run"
        );
    }

    // #endregion

    // #region Section: Streak

    function _streakSection() private pure returns (Section memory s) {
        s.title = "Streak";
        s.views = new View[](2);
        s.views[0] = _figure("Minimum balance", __MODULE__.threshold.selector, false, Unit.TokenAmount);
        s.views[1] = _figure("Your streak", __MODULE__.streakOf.selector, true, Unit.Duration);
        s.lists = new ListDecl[](0);
        s.actions = new Action[](1);
        s.actions[0] = _forgetAction();
        s.columns = 2;
        s.items = new Item[](3);
        s.items[0] = Item({kind: ItemKind.View, span: 0, index: 0});
        s.items[1] = Item({kind: ItemKind.View, span: 0, index: 1});
        s.items[2] = Item({kind: ItemKind.Action, span: 0, index: 0});
    }

    function _figure(string memory label, bytes4 selector, bool withViewer, Unit unit)
        private
        pure
        returns (View memory v)
    {
        v.widget = Widget.Figure;
        v.label = label;
        v.selectors = new bytes4[](1);
        v.selectors[0] = selector;
        v.withViewer = withViewer;
        v.unit = unit;
        v.labels = new string[](0);
        v.tones = new Tone[](0);
    }

    function _forgetAction() private pure returns (Action memory a) {
        a.name = "forget";
        a.description = "Drop your streak and start again from now";
        a.selector = __MODULE__.forget.selector;
        a.previewUnit = Unit.Raw;
        a.minOutInput = 0;
        a.deadlineInput = 0;
        a.flow = ActionFlow.None;
        a.inputs = new Field[](0);
    }

    function _events() private pure returns (EventDecl[] memory e) {
        e = new EventDecl[](1);
        e[0] = EventDecl({
            topic0: __MODULE__.StreakStarted.selector,
            signature: "StreakStarted(address indexed holder, uint256 since)",
            role: EventRole.Custom,
            walletArg: 0,
            amountArg: 1,
            keyArg: NO_EVENT_ARG,
            flagArg: NO_EVENT_ARG,
            textArg: NO_EVENT_ARG,
            amountUnit: Unit.Timestamp,
            tone: Tone.Positive,
            label: "Streak started"
        });
    }

    // #endregion
}

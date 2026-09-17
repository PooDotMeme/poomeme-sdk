// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {AlreadyInitialized, InvalidConfig, NotToken} from "@standard/PooErrors.sol";
import {IPooTokenModule} from "@token-module/IPooTokenModule.sol";
import {TokenModuleContext} from "@token-module/TokenModuleTypes.sol";
import {IPooTrackHook} from "@token-module/hooks/IPooTrackHook.sol";

contract __MODULE__ is IPooTokenModule, IPooTrackHook {
    // #region Shared

    address private _token;
    bool private _initialized;

    function initialize(TokenModuleContext calldata ctx, bytes calldata config) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        _token = ctx.token;
        uint256 wanted = abi.decode(config, (uint256));
        if (wanted == 0) revert InvalidConfig();
        _threshold = wanted;
    }

    function token() external view override returns (address) {
        return _token;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IPooTokenModule).interfaceId || interfaceId == type(IPooTrackHook).interfaceId
            || interfaceId == type(IERC165).interfaceId;
    }

    // #endregion

    // #region Streak

    uint256 private _threshold;
    mapping(address holder => uint256 since) private _startedAt;

    event StreakStarted(address indexed holder, uint256 since);

    function threshold() external view returns (uint256) {
        return _threshold;
    }

    function streakOf(address holder) external view returns (uint256) {
        uint256 since = _startedAt[holder];
        return since == 0 ? 0 : block.timestamp - since;
    }

    function track(address from, address to, uint256 fromBalance, uint256 toBalance) external override {
        if (msg.sender != _token) revert NotToken();
        if (fromBalance < _threshold) delete _startedAt[from];
        if (toBalance >= _threshold && _startedAt[to] == 0) {
            _startedAt[to] = block.timestamp;
            emit StreakStarted(to, block.timestamp);
        }
    }

    function forget() external {
        delete _startedAt[msg.sender];
    }

    // #endregion
}

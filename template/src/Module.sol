// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

contract __MODULE__ {
    // #region Clone

    uint256 private constant ARGS = 0x2d;
    uint256 private constant ARGS_LENGTH = 0x40;
    uint256 private constant CLONE_SIZE = ARGS + ARGS_LENGTH;

    error NotAClone();

    function token() public view returns (address token_) {
        (token_,) = _args();
    }

    function beneficiary() public view returns (address beneficiary_) {
        (, beneficiary_) = _args();
    }

    function _args() private view returns (address token_, address beneficiary_) {
        _requireClone();
        assembly ("memory-safe") {
            let p := mload(0x40)
            extcodecopy(address(), p, ARGS, ARGS_LENGTH)
            let mask := 0xffffffffffffffffffffffffffffffffffffffff
            token_ := and(mload(p), mask)
            beneficiary_ := and(mload(add(p, 0x20)), mask)
        }
    }

    function _requireClone() private view {
        if (address(this).code.length != CLONE_SIZE) revert NotAClone();
    }

    // #endregion

    // #region Vault

    event Released(address indexed to, uint256 amount);

    error NothingToRelease();

    receive() external payable {
        _requireClone();
    }

    function held() external view returns (uint256) {
        _requireClone();
        return address(this).balance;
    }

    function release() external returns (uint256 amount) {
        address to = beneficiary();
        amount = address(this).balance;
        if (amount == 0) revert NothingToRelease();
        (bool sent,) = payable(to).call{value: amount}("");
        require(sent, "release");
        emit Released(to, amount);
    }

    // #endregion
}

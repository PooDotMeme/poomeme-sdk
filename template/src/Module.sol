// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

contract __MODULE__ {
    // #region Vault

    address public immutable token;
    address public immutable beneficiary;

    event Released(address indexed to, uint256 amount);

    error NothingToRelease();

    constructor(address token_, address beneficiary_) {
        token = token_;
        beneficiary = beneficiary_;
    }

    receive() external payable {}

    function held() external view returns (uint256) {
        return address(this).balance;
    }

    function release() external returns (uint256 amount) {
        amount = address(this).balance;
        if (amount == 0) revert NothingToRelease();
        (bool sent,) = payable(beneficiary).call{value: amount}("");
        require(sent, "release");
        emit Released(beneficiary, amount);
    }

    // #endregion
}

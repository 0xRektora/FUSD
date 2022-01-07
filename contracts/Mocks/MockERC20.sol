// SPDX-License-Identifier: MIT

// 0xRektora

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

contract MockERC20 is ERC20 {
    constructor(uint256 _amount) ERC20('MockERC20', 'ME20') {
        _mint(msg.sender, _amount);
    }
}

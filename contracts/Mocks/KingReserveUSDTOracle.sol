// SPDX-License-Identifier: MIT

// 0xRektora

pragma solidity ^0.8.0;

import 'prb-math/contracts/PRBMathUD60x18.sol';

contract KingReserveUSDTOracle {
    using PRBMathUD60x18 for *;

    function getExchangeRate(uint256 amount) external view returns (uint256) {
        return amount.mul(10).div(100) + amount;
    }
}

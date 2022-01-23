// SPDX-License-Identifier: MIT

// 0xRektora

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol';

contract FUSD is ERC20Burnable {
    address public king;

    constructor(address _king) ERC20('Frog USD', 'FUSD') {
        king = _king;
    }

    modifier onlyKing() {
        require(msg.sender == king, 'FUSD: Only king is authorized');
        _;
    }

    function mint(address _account, uint256 _amount) public onlyKing {
        _mint(_account, _amount);
    }

    function claimCrown(address _newKing) external onlyKing {
        king = _newKing;
    }
}

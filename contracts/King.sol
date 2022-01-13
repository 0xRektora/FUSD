// SPDX-License-Identifier: MIT

// 0xRektora

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import 'prb-math/contracts/PRBMathUD60x18.sol';
import './WUSD.sol';

interface IReserveOracle {
    function getExchangeRate(uint256 amount) external view returns (uint256);
}

/// @title King contract. Mint/Burn $WUSD against chosen assets
/// @author 0xRektora
/// @notice Crown has the ability to add and disable reserve, which can be any ERC20 (stable/LP) given an oracle
/// that compute the exchange rates between $WUSD and the latter.
/// @dev Potential flaw of this tokenomics:
/// - Ability for the crown to change freely reserve parameters. (suggestion: immutable reserve/reserve parameter)
/// - Ability to withdraw assets and break the burning mechanism.
/// (suggestion: if reserve not immutable, compute a max amount withdrawable delta for a given reserve)
contract King {
    using PRBMathUD60x18 for uint256;
    using PRBMathUD60x18 for uint128;

    struct Reserve {
        uint128 mintingInterestRate; // In Bps
        uint128 burningTaxRate; // In Bps
        uint256 vestingPeriod;
        IReserveOracle reserveOracle;
        bool disabled;
    }

    struct Vesting {
        uint256 unlockPeriod; // In block
        uint256 amount; // In WUSD
    }

    address public crown;
    WUSD public wusd;
    address public sWagmeKingdom;
    uint256 public sWagmeTaxRate; // In Bps

    address[] public reserveAddresses;
    mapping(address => Reserve) public reserves;
    mapping(address => Vesting) public vestings;

    event RegisteredReserve(
        address indexed reserve,
        uint256 index,
        uint256 blockNumber,
        uint128 mintingInterestRate,
        uint128 burningTaxRate,
        uint256 vestingPeriod,
        address reserveOracle,
        bool disabled
    );
    event Praise(address indexed reserve, address indexed to, uint256 amount);
    event Reprove(address indexed reserve, address indexed from, uint256 amount);
    event VestingRedeem(address indexed to, uint256 amount);
    event WithdrawReserve(address indexed reserve, address indexed to, uint256 amount);

    modifier onlyCrown() {
        require(msg.sender == crown, 'King: Only crown can execute');
        _;
    }

    modifier reserveExists(address _reserve) {
        Reserve storage reserve = reserves[_reserve];
        require(address(reserve.reserveOracle) != address(0), "King: reserve doesn't exists");
        require(!reserve.disabled, 'King: reserve disabled');
        _;
    }

    constructor(
        address _wusd,
        address _sWagmeKingdom,
        uint256 _sWagmeTaxRate
    ) {
        crown = msg.sender;
        wusd = WUSD(_wusd);
        sWagmeKingdom = _sWagmeKingdom;
        sWagmeTaxRate = _sWagmeTaxRate;
    }

    /// @notice Use this function to create/change parameters of a given reserve
    /// @dev We inline assign each state to save gas instead of using Struct constructor
    /// @dev Potential flaw of this tokenomics:
    /// - Ability for the crown to change freely reserve parameters. (suggestion: immutable reserve/reserve parameter)
    /// @param _reserve the address of the asset to be used (ERC20 compliant)
    /// @param _mintingInterestRate The interest rate to be vested at mint
    /// @param _burningTaxRate The Burning tax rate that will go to sWagme holders
    /// @param _vestingPeriod The period where the interests will unlock
    /// @param _reserveOracle The oracle that is used for the exchange rate
    /// @param _disabled Controls the ability to be able to mint or not with the given asset
    function bless(
        address _reserve,
        uint128 _mintingInterestRate,
        uint128 _burningTaxRate,
        uint256 _vestingPeriod,
        address _reserveOracle,
        bool _disabled
    ) public onlyCrown {
        require(_reserveOracle != address(0), 'King: Invalid oracle');
        Reserve storage reserve = reserves[_reserve];
        reserve.mintingInterestRate = _mintingInterestRate;
        reserve.burningTaxRate = _burningTaxRate;
        reserve.vestingPeriod = _vestingPeriod;
        reserve.reserveOracle = IReserveOracle(_reserveOracle);
        reserve.disabled = _disabled;
        // !\ Careful of gas cost /!\
        if (!doesReserveExists(_reserve)) {
            reserveAddresses.push(_reserve);
        }
        emit RegisteredReserve(
            _reserve,
            reserveAddresses.length - 1,
            block.number,
            _mintingInterestRate,
            _burningTaxRate,
            _vestingPeriod,
            _reserveOracle,
            _disabled
        );
    }

    /// @notice Mint a given [[_amount]] of $WUSD using [[_reserve]] asset to an [[_account]]
    /// @dev Compute and send to the King the amount of [[_reserve]] in exchange of $WUSD.
    /// The $WUSD minted takes in consideration vestings
    /// @param _reserve The asset to be used (ERC20)
    /// @param _account The receiver of $WUSD
    /// @param _amount The amount of $WUSD minted
    /// @return _amount True amount of $WUSD minted
    function praise(
        address _reserve,
        address _account,
        uint256 _amount
    ) public reserveExists(_reserve) returns (uint256) {
        Reserve storage reserve = reserves[_reserve];

        uint256 toExchange = reserve.reserveOracle.getExchangeRate(_amount);

        IERC20(_reserve).transferFrom(msg.sender, address(this), toExchange);

        Vesting storage vesting = vestings[_account];
        // If the vesting period is unlocked, add it to the total to be minted
        if (block.number >= vesting.unlockPeriod) {
            _amount += vesting.amount;
            emit VestingRedeem(_account, vesting.amount);
        }
        // Reset the vesting params
        vesting.unlockPeriod = block.number + reserve.vestingPeriod;
        vesting.amount = _amount.mul(reserve.mintingInterestRate).div(10000);

        wusd.mint(_account, _amount);
        emit Praise(_reserve, _account, _amount);

        return _amount;
    }

    /// @notice Burn $WUSD in exchange of the desired reserve. A certain amount could be taxed and sent to sWagme
    /// @param _reserve The reserve to exchange with
    /// @param _amount The amount of $WUSD to reprove
    /// @return toExchange The amount of chosen reserve exchanged
    function reprove(address _reserve, uint256 _amount) public reserveExists(_reserve) returns (uint256 toExchange) {
        Reserve storage reserve = reserves[_reserve];
        uint256 sWagmeTax = _amount.mul(sWagmeTaxRate).div(10000);
        toExchange = IReserveOracle(reserve.reserveOracle).getExchangeRate(_amount - sWagmeTax);

        // Send to WAGME
        wusd.burnFrom(msg.sender, _amount - sWagmeTax);
        wusd.transferFrom(msg.sender, sWagmeKingdom, sWagmeTax);

        // Send underlyings to sender
        IERC20(_reserve).transfer(msg.sender, toExchange);

        emit Reprove(_reserve, msg.sender, _amount);
    }

    /// @notice Redeem any ongoing vesting for a given account
    /// @dev Mint $WUSD and reset vesting terms
    /// @param _account The vesting account
    /// @return redeemed The amount of $WUSD redeemed
    function redeemVesting(address _account) public returns (uint256 redeemed) {
        Vesting storage vesting = vestings[_account];
        if (block.number >= vesting.unlockPeriod) {
            redeemed = vesting.amount;
            vesting.amount = 0;
            wusd.mint(_account, redeemed);
            emit VestingRedeem(_account, redeemed);
        }
    }

    /// @notice Useful for frontend. Get an estimate exchange of $WUSD vs desired reserve.
    /// takes in account any vested amount
    /// @param _reserve The asset to be used (ERC20)
    /// @param _account The receiver of $WUSD
    /// @param _amount The amount of $WUSD to mint
    /// @return toExchange Amount of reserve to exchange,
    /// @return amount True amount of $WUSD to be exchanged
    /// @return vested Any vesting created
    function getPraiseEstimates(
        address _reserve,
        address _account,
        uint256 _amount
    )
        public
        view
        reserveExists(_reserve)
        returns (
            uint256 toExchange,
            uint256 amount,
            uint256 vested
        )
    {
        Reserve storage reserve = reserves[_reserve];
        Vesting storage vesting = vestings[_account];

        toExchange = reserve.reserveOracle.getExchangeRate(_amount);
        // If there vesting period is unlocked, add it to the total minted
        if (block.number >= vesting.unlockPeriod) {
            _amount += vesting.amount;
        }
        vested = _amount.mul(reserve.mintingInterestRate).div(10000);
        amount = _amount;
    }

    /// @notice Check if a reserve was created
    /// @dev /!\ Careful of gas cost /!\
    /// @param _reserve The reserve to check
    /// @return exists A boolean of its existence
    function doesReserveExists(address _reserve) public view returns (bool exists) {
        for (uint256 i = 0; i < reserveAddresses.length; i++) {
            if (reserveAddresses[i] == _reserve) {
                exists = true;
                break;
            }
        }
    }

    /// @notice Withdraw [[_to]] a given [[_amount]] of [[_reserve]]
    /// @dev Potential flaw of this tokenomics:
    /// - Ability to withdraw assets and break the burning mechanism.
    /// (suggestion: if reserve not immutable, compute a max amount withdrawable delta for a given reserve)
    /// @param _reserve The asset to be used (ERC20)
    /// @param _to The receiver
    /// @param _amount The amount to withdraw
    function withdrawReserve(
        address _reserve,
        address _to,
        uint256 _amount
    ) public onlyCrown {
        require(address(reserves[_reserve].reserveOracle) != address(0), "King: reserve doesn't exists");
        IERC20(_reserve).transfer(_to, _amount);
        emit WithdrawReserve(_reserve, _to, _amount);
    }

    /// @notice Drain every reserve [[_to]]
    /// @dev /!\ Careful of gas cost /!\
    /// @dev Potential flaw of this tokenomics:
    /// - Ability to withdraw assets and break the burning mechanism.
    /// (suggestion: if reserve not immutable, compute a max amount withdrawable delta for a given reserve)
    /// @param _to The receiver
    function withdrawAll(address _to) public onlyCrown {
        for (uint256 i = 0; i < reserveAddresses.length; i++) {
            IERC20 reserveERC20 = IERC20(reserveAddresses[i]);
            uint256 amount = reserveERC20.balanceOf(address(this));
            reserveERC20.transfer(_to, amount);
            emit WithdrawReserve(address(reserveERC20), _to, amount);
        }
    }

    /// @notice Update the sWagmeKingdom address
    /// @param _sWagmeKingdom The new address
    function updateSWagmeKingdom(address _sWagmeKingdom) public onlyCrown {
        sWagmeKingdom = _sWagmeKingdom;
    }

    /// @notice Update the sWagmeTaxRate state var
    /// @param _sWagmeTaxRate The new tax rate
    function updateSWagmeTaxRate(uint256 _sWagmeTaxRate) public onlyCrown {
        sWagmeTaxRate = _sWagmeTaxRate;
    }

    /// @notice Update the owner
    /// @param _newKing of the new owner
    function crownKing(address _newKing) public onlyCrown {
        crown = _newKing;
    }

    /// @notice Transfer an ERC20 to the king
    /// @param erc20 The address of the token to transfer
    /// @param amount The amount to transfer
    function salvage(address erc20, uint256 amount) public onlyCrown {
        IERC20(erc20).transfer(crown, amount);
    }

    /// @notice Withdraw the native currency to the king
    /// @param amount The amount to be withdrawn
    function withdrawNative(uint256 amount) public onlyCrown {
        crown.transfer(amount);
    }
}

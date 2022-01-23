// SPDX-License-Identifier: MIT

// 0xRektora

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import './FUSD.sol';

interface IReserveOracle {
    function getExchangeRate(uint256 amount) external view returns (uint256);
}

/// @title King contract. Mint/Burn $FUSD against chosen assets
/// @author 0xRektora (https://github.com/0xRektora)
/// @notice Crown has the ability to add and disable reserve, which can be any ERC20 (stable/LP) given an oracle
/// that compute the exchange rates between $FUSD and the latter.
contract King {
    struct Reserve {
        uint128 mintingInterestRate; // In Bps
        uint128 burningTaxRate; // In Bps
        uint256 vestingPeriod;
        IReserveOracle reserveOracle;
        bool disabled;
        bool isReproveWhitelisted;
        uint256 sWagmeTaxRate; // In Bps
    }

    struct Vesting {
        uint256 unlockPeriod; // In block
        uint256 amount; // In FUSD
    }

    address public crown;
    FUSD public fusd;
    address public sWagmeKingdom;

    address[] public reserveAddresses;
    address[] public reserveReproveWhitelistAddresses; // Array of whitelisted reserve accepted in reprove()
    mapping(address => Reserve) public reserves;
    mapping(address => Vesting[]) public vestings;

    mapping(address => uint256) public freeReserves; // In FUSD

    event RegisteredReserve(
        address indexed reserve,
        uint256 index,
        uint256 blockNumber,
        uint128 mintingInterestRate,
        uint128 burningTaxRate,
        uint256 vestingPeriod,
        address reserveOracle,
        bool disabled,
        bool isReproveWhitelisted, // If this reserve can be used by users to reprove()
        uint256 sWagmeTaxRate
    );
    event Praise(address indexed reserve, address indexed to, uint256 amount, Vesting vesting);
    event Reprove(address indexed reserve, address indexed from, uint256 amount);
    event VestingRedeem(address indexed to, uint256 amount);
    event WithdrawReserve(address indexed reserve, address indexed to, uint256 amount);
    event UpdateReserveReproveWhitelistAddresses(address indexed reserve, bool newVal, bool created);

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

    constructor(address _fusd, address _sWagmeKingdom) {
        crown = msg.sender;
        fusd = FUSD(_fusd);
        sWagmeKingdom = _sWagmeKingdom;
    }

    /// @notice Returns the total number of reserves
    /// @return Length of [[reserveAddresses]]
    function reserveAddressesLength() external view returns (uint256) {
        return reserveAddresses.length;
    }

    /// @notice Returns the total number of whitelisted reserves for [[reprove()]]
    /// @return Length of [[reserveReproveWhitelistAddresses]]
    function reserveReproveWhitelistAddressesLength() external view returns (uint256) {
        return reserveReproveWhitelistAddresses.length;
    }

    /// @notice Use this function to create/change parameters of a given reserve
    /// @dev We inline assign each state to save gas instead of using Struct constructor
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
        bool _disabled,
        bool _isReproveWhitelisted,
        uint256 _sWagmeTaxRate
    ) external onlyCrown {
        require(_reserveOracle != address(0), 'King: Invalid oracle');

        // Add or remove the reserve if needed from reserveReproveWhitelistAddresses

        Reserve storage reserve = reserves[_reserve];
        _updateReserveReproveWhitelistAddresses(reserve, _reserve, _isReproveWhitelisted);
        reserve.mintingInterestRate = _mintingInterestRate;
        reserve.burningTaxRate = _burningTaxRate;
        reserve.vestingPeriod = _vestingPeriod;
        reserve.reserveOracle = IReserveOracle(_reserveOracle);
        reserve.disabled = _disabled;
        reserve.isReproveWhitelisted = _isReproveWhitelisted;
        reserve.sWagmeTaxRate = _sWagmeTaxRate;

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
            _disabled,
            _isReproveWhitelisted,
            _sWagmeTaxRate
        );
    }

    /// @notice Mint a given [[_amount]] of $FUSD using [[_reserve]] asset to an [[_account]]
    /// @dev Compute and send to the King the amount of [[_reserve]] in exchange of $FUSD.
    /// @param _reserve The asset to be used (ERC20)
    /// @param _account The receiver of $FUSD
    /// @param _amount The amount of $FUSD minted
    /// @return totalMinted True amount of $FUSD minted
    function praise(
        address _reserve,
        address _account,
        uint256 _amount
    ) external reserveExists(_reserve) returns (uint256 totalMinted) {
        Reserve storage reserve = reserves[_reserve];
        totalMinted += _amount;

        uint256 toExchange = reserve.reserveOracle.getExchangeRate(_amount);

        IERC20(_reserve).transferFrom(msg.sender, address(this), toExchange);

        freeReserves[_reserve] += (_amount * reserve.burningTaxRate) / 10000;

        Vesting[] storage accountVestings = vestings[_account];
        Vesting memory vesting;
        vesting.unlockPeriod = block.number + reserve.vestingPeriod;
        vesting.amount = (_amount * reserve.mintingInterestRate) / 10000;
        accountVestings.push(vesting);

        totalMinted -= vesting.amount;

        fusd.mint(_account, totalMinted);
        emit Praise(_reserve, _account, totalMinted, vesting);

        return totalMinted;
    }

    /// @notice Burn $FUSD in exchange of the desired reserve. A certain amount could be taxed and sent to sWagme
    /// @param _reserve The reserve to exchange with
    /// @param _amount The amount of $FUSD to reprove
    /// @return toExchange The amount of chosen reserve exchanged
    function reprove(address _reserve, uint256 _amount) external reserveExists(_reserve) returns (uint256 toExchange) {
        Reserve storage reserve = reserves[_reserve];
        require(reserve.isReproveWhitelisted, 'King: reserve not whitelisted for reproval');
        uint256 sWagmeTax = (_amount * reserve.sWagmeTaxRate) / 10000;
        toExchange = IReserveOracle(reserve.reserveOracle).getExchangeRate(_amount - sWagmeTax);

        // Send to WAGME
        fusd.burnFrom(msg.sender, _amount - sWagmeTax);
        fusd.transferFrom(msg.sender, sWagmeKingdom, sWagmeTax);

        // Send underlyings to sender
        IERC20(_reserve).transfer(msg.sender, toExchange);

        emit Reprove(_reserve, msg.sender, _amount);
    }

    /// @notice View function to return info about an account vestings
    /// @param _account The account to check for
    /// @return redeemable The amount of $FUSD that can be redeemed
    /// @return numOfVestings The number of vestings of [[_account]]
    function getVestingInfos(address _account) external view returns (uint256 redeemable, uint256 numOfVestings) {
        Vesting[] memory accountVestings = vestings[_account];
        uint256 arrLength = accountVestings.length;
        numOfVestings = arrLength;
        for (uint256 i; i < arrLength; i++) {
            uint256 tmp = _computeRedeemableVestings(accountVestings, i);
            redeemable += tmp;
            if (tmp > 0) {
                arrLength--;
            }
            if (arrLength > 0 && i == arrLength - 1) {
                redeemable += tmp;
            }
        }
    }

    /// @dev Used by [[getVestingInfos()]]
    /// @param _accountVestings A memory copy of [[vestings]]
    /// @param _i The element of array to deal with (must be withing bounds, no checks are made)
    /// @return redeemed The total redeemed, if > 0 array size is lower
    function _computeRedeemableVestings(Vesting[] memory _accountVestings, uint256 _i)
        internal
        view
        returns (uint256 redeemed)
    {
        if (block.number >= _accountVestings[_i].unlockPeriod) {
            redeemed += _accountVestings[_i].amount;
            // We remove the vesting when redeemed
            _accountVestings[_i] = _accountVestings[_accountVestings.length - 1];
        }
    }

    /// @notice Redeem any ongoing vesting for a given account
    /// @dev Mint $FUSD and remove vestings that has been redeemed from [[vestings[_account]]]
    /// @param _account The vesting account
    /// @return redeemed The amount of $FUSD redeemed
    function redeemVestings(address _account) external returns (uint256 redeemed) {
        Vesting[] storage accountVestings = vestings[_account];
        for (uint256 i; i < accountVestings.length; i++) {
            redeemed += _redeemVesting(accountVestings, i);
            if (accountVestings.length > 0 && i == accountVestings.length - 1) {
                redeemed += _redeemVesting(accountVestings, i);
            }
        }
        if (redeemed > 0) {
            fusd.mint(_account, redeemed);
            emit VestingRedeem(_account, redeemed);
        }
    }

    /// @dev May remove element from the passed array of [[_accountVestings]]
    /// @param _accountVestings The storage of [[vestings]]
    /// @param _i The element of array to deal with (must be withing bounds, no checks are made)
    /// @return redeemed The total redeemed, if > 0 array size is lower
    function _redeemVesting(Vesting[] storage _accountVestings, uint256 _i) internal returns (uint256 redeemed) {
        if (block.number >= _accountVestings[_i].unlockPeriod) {
            redeemed += _accountVestings[_i].amount;
            // We remove the vesting when redeemed
            _accountVestings[_i] = _accountVestings[_accountVestings.length - 1];
            _accountVestings.pop();
        }
    }

    /// @notice Useful for frontend. Get an estimate exchange of $FUSD vs desired reserve.
    /// @param _reserve The asset to be used (ERC20)
    /// @param _amount The amount of $FUSD to mint
    /// @return toExchange Amount of reserve to exchange,
    /// @return amount True amount of $FUSD to be exchanged
    /// @return vested Any vesting created
    function getPraiseEstimates(address _reserve, uint256 _amount)
        external
        view
        reserveExists(_reserve)
        returns (
            uint256 toExchange,
            uint256 amount,
            uint256 vested
        )
    {
        Reserve storage reserve = reserves[_reserve];

        toExchange = reserve.reserveOracle.getExchangeRate(_amount);
        vested = (_amount * reserve.mintingInterestRate) / 10000;
        amount = _amount - vested;
    }

    /// @notice Check if a reserve was created
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

    /// @notice Get the conversion of $FUSD -> [[_reserve]]
    /// @param _reserve The output valuation
    /// @param _amount The amount of $FUSD to value
    /// @return The [[_reserve]] valuation for the given $FUSD
    function conversionRateFUSDToReserve(address _reserve, uint256 _amount)
        external
        view
        reserveExists(_reserve)
        returns (uint256)
    {
        return reserves[_reserve].reserveOracle.getExchangeRate(_amount);
    }

    /// @notice Get the conversion of [[_reserve]] -> $FUSD
    /// @param _reserve The input valuation
    /// @param _amount The amount of [[_reserve]] to value
    /// @return The $FUSD valuation for the given [[_reserve]]
    function conversionRateReserveToFUSD(address _reserve, uint256 _amount)
        external
        view
        reserveExists(_reserve)
        returns (uint256)
    {
        return (_amount * 10) / reserves[_reserve].reserveOracle.getExchangeRate(10);
    }

    /// @notice Withdraw [[_to]] a given [[_amount]] of [[_reserve]] and reset its freeReserves
    /// @param _reserve The asset to be used (ERC20)
    /// @param _to The receiver
    /// @param _amount The amount to withdrawn
    function withdrawReserve(
        address _reserve,
        address _to,
        uint256 _amount
    ) external onlyCrown {
        require(address(reserves[_reserve].reserveOracle) != address(0), "King: reserve doesn't exists");
        IERC20(_reserve).transfer(_to, _amount);
        // Based on specs, reset behavior is wanted
        freeReserves[_reserve] = 0; // Reset freeReserve
        emit WithdrawReserve(_reserve, _to, _amount);
    }

    /// @notice Drain every reserve [[_to]] and reset all freeReserves
    /// @param _to The receiver
    function withdrawAll(address _to) external onlyCrown {
        for (uint256 i = 0; i < reserveAddresses.length; i++) {
            IERC20 reserveERC20 = IERC20(reserveAddresses[i]);
            uint256 amount = reserveERC20.balanceOf(address(this));
            reserveERC20.transfer(_to, amount);
            freeReserves[reserveAddresses[i]] = 0; // Reset freeReserve
            emit WithdrawReserve(address(reserveERC20), _to, amount);
        }
    }

    /// @notice Withdraw a chosen amount of free reserve in the chosen reserve
    /// @param _reserve The asset to be used (ERC20)
    /// @param _to The receiver
    /// @param _amount The amount to withdrawn (in FUSD)
    /// @return assetWithdrawn The amount of asset withdrawn after the exchange rate
    function withdrawFreeReserve(
        address _reserve,
        address _to,
        uint256 _amount
    ) public onlyCrown returns (uint256 assetWithdrawn) {
        require(_amount <= freeReserves[_reserve], 'King: max amount exceeded');
        Reserve storage reserve = reserves[_reserve];
        assetWithdrawn = reserve.reserveOracle.getExchangeRate(_amount);
        freeReserves[_reserve] -= _amount;
        IERC20(_reserve).transfer(_to, assetWithdrawn);
    }

    function withdrawAllFreeReserve(address _reserve, address _to) external onlyCrown returns (uint256 assetWithdrawn) {
        assetWithdrawn = withdrawFreeReserve(_reserve, _to, freeReserves[_reserve]);
    }

    /// @notice Update the sWagmeKingdom address
    /// @param _sWagmeKingdom The new address
    function updateSWagmeKingdom(address _sWagmeKingdom) external onlyCrown {
        sWagmeKingdom = _sWagmeKingdom;
    }

    /// @notice Update the owner
    /// @param _newKing of the new owner
    function crownKing(address _newKing) external onlyCrown {
        crown = _newKing;
    }

    /// @notice Transfer an ERC20 to the king
    /// @param _erc20 The address of the token to transfer
    /// @param _to The address of the receiver
    /// @param _amount The amount to transfer
    function salvage(
        address _erc20,
        address _to,
        uint256 _amount
    ) external onlyCrown {
        IERC20(_erc20).transfer(_to, _amount);
    }

    /// @notice Withdraw the native currency to the king
    /// @param _to The address of the receiver
    /// @param _amount The amount to be withdrawn
    function withdrawNative(address payable _to, uint256 _amount) external onlyCrown {
        _to.transfer(_amount);
    }

    /// @notice Return the current list of reserves
    /// @return Return [[reserveAddresses]]
    function getReserveAddresses() external view returns (address[] memory) {
        return reserveAddresses;
    }

    /// @notice Return the current list of whitelisted reserve to be reproved
    /// @return Return [[reserveReproveWhitelistAddresses]]
    function getReserveReproveWhitelistAddresses() external view returns (address[] memory) {
        return reserveReproveWhitelistAddresses;
    }

    /// @dev Updated [[reserveReproveWhitelistAddresses]] when a reserve is updated or appended.
    /// Changes occurs only if needed. It is designed to be called only at the begining of a blessing [[bless()]]
    /// @param _reserve The reserve being utilized
    /// @param _reserveAddress The address of the reserve
    /// @param _isReproveWhitelisted The most updated version of reserve.isReproveWhitelisted
    function _updateReserveReproveWhitelistAddresses(
        Reserve memory _reserve,
        address _reserveAddress,
        bool _isReproveWhitelisted
    ) internal {
        // Check if it exists
        if (address(_reserve.reserveOracle) != address(0)) {
            // We'll act only if there was changes
            if (_reserve.isReproveWhitelisted != _isReproveWhitelisted) {
                // We'll add or remove it from reserveReproveWhitelistAddresses based on the previous param
                if (_isReproveWhitelisted) {
                    // Added to the whitelist
                    reserveReproveWhitelistAddresses.push(_reserveAddress);
                    emit UpdateReserveReproveWhitelistAddresses(_reserveAddress, true, false);
                } else {
                    // Remove it from the whitelist
                    for (uint256 i = 0; i < reserveReproveWhitelistAddresses.length; i++) {
                        if (reserveReproveWhitelistAddresses[i] == _reserveAddress) {
                            // Get the last element in the removed element
                            reserveReproveWhitelistAddresses[i] = reserveReproveWhitelistAddresses[
                                reserveReproveWhitelistAddresses.length - 1
                            ];
                            reserveReproveWhitelistAddresses.pop();
                            emit UpdateReserveReproveWhitelistAddresses(_reserveAddress, false, false);
                        }
                    }
                }
            }
        } else {
            // If the reserve is new, we'll add it to the whitelist only if it's whitelisted
            if (_isReproveWhitelisted) {
                reserveReproveWhitelistAddresses.push(_reserveAddress);
                emit UpdateReserveReproveWhitelistAddresses(_reserveAddress, true, true);
            }
        }
    }
}

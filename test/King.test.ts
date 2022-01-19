import { expect } from 'chai';
import { ethers } from 'hardhat';

const setBalance = async (addr: string, ether: number) => {
  await ethers.provider.send('hardhat_setBalance', [
    addr,
    ethers.utils.hexStripZeros(ethers.utils.parseEther(String(ether))._hex),
  ]);
};

const getAddresses = async () => {
  const deployer = (await ethers.getSigners())[0];
  const sWagmeKingdom = new ethers.Wallet(ethers.Wallet.createRandom().privateKey, ethers.provider);

  const wusd = await (await ethers.getContractFactory('WUSD')).deploy(deployer.address);
  await wusd.deployed();

  const king = await (await ethers.getContractFactory('King')).deploy(wusd.address, sWagmeKingdom.address, 5000);
  await (await wusd.claimCrown(king.address)).wait();

  const mockERC20 = await (await ethers.getContractFactory('MockERC20')).deploy(ethers.utils.parseEther('10'));
  const mockERC20_2 = await (await ethers.getContractFactory('MockERC20')).deploy(ethers.utils.parseEther('10'));

  const usdtOracle = await (await ethers.getContractFactory('KingReserveUSDTOracle')).deploy();

  const eoa1 = new ethers.Wallet(ethers.Wallet.createRandom().privateKey, ethers.provider);
  await setBalance(eoa1.address, 1000000);

  return {
    deployer,
    king,
    wusd,
    mockERC20,
    mockERC20_2,
    usdtOracle,
    eoa1,
    sWagmeKingdom,
  };
};

const addReserve = async (
  king: any,
  underlyingAddr: string,
  oracleAddr: string,
  disabled?: boolean,
  isReproveWhitelisted?: boolean,
) => {
  await (
    await king.bless(
      underlyingAddr,
      1000,
      2000,
      5,
      oracleAddr,
      disabled !== undefined ? disabled : false,
      isReproveWhitelisted !== undefined ? isReproveWhitelisted : true,
    )
  ).wait();
};

const mine = async (blocks: number) => {
  for (let i = 0; i < blocks; i++) {
    await ethers.provider.send('evm_mine', []);
  }
};

describe('King', () => {
  describe('bless', () => {
    it('Should let the owner to add a reserve', async () => {
      const { king, mockERC20, usdtOracle, eoa1 } = await getAddresses();

      // Only crown can execute
      await expect(
        king.connect(eoa1).bless(mockERC20.address, 1000, 2000, 5, usdtOracle.address, false, true),
      ).to.be.revertedWith('King: Only crown can execute');

      // Event emitted
      await expect(king.bless(mockERC20.address, 1000, 2000, 5, usdtOracle.address, false, true))
        .to.emit(king, 'RegisteredReserve')
        .withArgs(
          mockERC20.address,
          0,
          (await ethers.provider.getBlockNumber()) + 1,
          1000,
          2000,
          5,
          usdtOracle.address,
          false,
          true,
        );

      // reserveAddresses array pushed oracle
      expect(await king.reserveAddresses(0)).to.equal(mockERC20.address);

      // Partial check if the reserve has been correctly added to the mapping
      expect((await king.reserves(mockERC20.address)).reserveOracle).to.equal(usdtOracle.address);
      // Check if the reserve has been correctly added to the array
      expect(await king.doesReserveExists(mockERC20.address)).to.equal(true);
    });
    it('Should update reserveReproveWhitelistAddresses when updating reserve', async () => {
      const { king, mockERC20, usdtOracle } = await getAddresses();

      await expect(king.bless(mockERC20.address, 1000, 2000, 5, usdtOracle.address, false, true))
        .to.emit(king, 'UpdateReserveReproveWhitelistAddresses')
        // Whitelist added and created
        .withArgs(mockERC20.address, true, true);
      expect(await king.reserveReproveWhitelistAddresses(0)).to.equal(mockERC20.address);
      expect((await king.reserves(mockERC20.address)).isReproveWhitelisted).to.equal(true);

      await expect(king.bless(mockERC20.address, 1000, 2000, 5, usdtOracle.address, false, false))
        .to.emit(king, 'UpdateReserveReproveWhitelistAddresses')
        // Whitelist updated to false
        .withArgs(mockERC20.address, false, false);
      expect(await king.reserveReproveWhitelistAddressesLength()).to.equal(ethers.BigNumber.from(0));
      expect((await king.reserves(mockERC20.address)).isReproveWhitelisted).to.equal(false);

      await expect(king.bless(mockERC20.address, 1000, 2000, 5, usdtOracle.address, false, false))
        // Whitelist updated to false (no change happens)
        .to.not.emit(king, 'UpdateReserveReproveWhitelistAddresses');
      expect(await king.reserveReproveWhitelistAddressesLength()).to.equal(ethers.BigNumber.from(0));
      expect((await king.reserves(mockERC20.address)).isReproveWhitelisted).to.equal(false);

      await expect(king.bless(mockERC20.address, 1000, 2000, 5, usdtOracle.address, false, true))
        .to.emit(king, 'UpdateReserveReproveWhitelistAddresses')
        // Whitelist updated to true
        .withArgs(mockERC20.address, true, false);
      expect(await king.reserveReproveWhitelistAddresses(0)).to.equal(mockERC20.address);
      expect((await king.reserves(mockERC20.address)).isReproveWhitelisted).to.equal(true);
    });
  });

  describe('getPraiseEstimates', () => {
    it("Should fail if the reserve doesn't exists", async () => {
      const { deployer, king, mockERC20 } = await getAddresses();
      expect(king.getPraiseEstimates(mockERC20.address, 1)).to.be.revertedWith("King: reserve doesn't exists");
    });

    it('Should fail if the reserve is disabled', async () => {
      const { deployer, king, mockERC20, usdtOracle } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address, true);

      await expect(king.getPraiseEstimates(mockERC20.address, 1)).to.be.revertedWith('King: reserve disabled');
    });

    it('Should estimate 1 WUSD would estimate to 1.1 $MockERC20 exchanged, 1 $WUSD minted and 0.1 $WUSD vested', async () => {
      const { deployer, king, mockERC20, usdtOracle } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const amount = ethers.utils.parseEther('1');
      const vested = amount.mul(10).div(100);
      const toExchange = await usdtOracle.getExchangeRate(amount);

      expect(await king.getPraiseEstimates(mockERC20.address, amount)).to.eql([toExchange, amount.sub(vested), vested]);
    });
  });

  describe('praise', () => {
    it("Should fail if the reserve doesn't exists", async () => {
      const { deployer, king, mockERC20 } = await getAddresses();
      await expect(king.praise(mockERC20.address, deployer.address, 1)).to.be.revertedWith(
        "King: reserve doesn't exists",
      );
    });

    it("Should fail if the minter doesn't have the assets", async () => {
      const { king, mockERC20, usdtOracle, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);
      await expect(king.connect(eoa1).praise(mockERC20.address, eoa1.address, 1)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance',
      );
    });

    it('Should fail if the reserve is disabled', async () => {
      const { deployer, king, mockERC20, usdtOracle } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address, true);

      await expect(king.praise(mockERC20.address, deployer.address, 1)).to.be.revertedWith('King: reserve disabled');
    });

    it('Should mint successfully 1 $WUSD against 1.1 $MockERC20', async () => {
      const { deployer, king, wusd, mockERC20, usdtOracle, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);
      const vestingCreated = mintAmount.mul((await king.reserves(mockERC20.address)).mintingInterestRate).div(10000);
      const wusdMinted = mintAmount.sub(vestingCreated);

      await (await mockERC20.approve(king.address, underlyingExchanged)).wait();
      await expect(king.praise(mockERC20.address, deployer.address, mintAmount))
        .to.emit(mockERC20, 'Transfer')
        .withArgs(deployer.address, king.address, underlyingExchanged)
        .and.to.emit(wusd, 'Transfer')
        .withArgs('0x'.padEnd(42, '0'), deployer.address, wusdMinted)
        .and.to.emit(king, 'Praise');

      expect(await wusd.balanceOf(deployer.address)).to.equal(wusdMinted);
    });

    it('Should add new vesting entries for account', async () => {
      const { deployer, king, mockERC20, usdtOracle } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);
      const vestingCreated = mintAmount.mul((await king.reserves(mockERC20.address)).mintingInterestRate).div(10000);

      await (await mockERC20.approve(king.address, underlyingExchanged.mul(2))).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();

      expect((await king.vestings(deployer.address, 0)).amount).to.equal(vestingCreated);
      expect((await king.vestings(deployer.address, 1)).amount).to.equal(vestingCreated);
    });

    it('Should add the burningTax of the reserve into its freeReserve', async () => {
      const { deployer, king, mockERC20, usdtOracle, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);
      const expectedFreeReserveAddedInFUSD = mintAmount
        .mul((await king.reserves(mockERC20.address)).burningTaxRate)
        .div(10000);

      await (await mockERC20.approve(king.address, underlyingExchanged.mul(2))).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();
      expect(await king.freeReserves(mockERC20.address)).to.be.equal(expectedFreeReserveAddedInFUSD);

      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();
      expect(await king.freeReserves(mockERC20.address)).to.be.equal(expectedFreeReserveAddedInFUSD.mul(2));
    });
  });

  describe('getVestingInfos', () => {
    it('Should compute the proper vesting infos', async () => {
      const { deployer, king, wusd, mockERC20, usdtOracle } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);
      const vestingCreated = mintAmount.mul((await king.reserves(mockERC20.address)).mintingInterestRate).div(10000);

      await (await mockERC20.approve(king.address, underlyingExchanged.mul(2))).wait();

      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();

      await mine(5);

      const vestingInfos = await king.getVestingInfos(deployer.address);

      expect(vestingInfos.redeemable).to.be.equal(vestingCreated.mul(2));
      expect(vestingInfos.numOfVestings).to.be.equal(ethers.BigNumber.from(2));
    });
  });

  describe('redeemVestings', () => {
    it('Should redeem 0 from vestings', async () => {
      const { deployer, king, wusd, mockERC20, usdtOracle, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);

      await (await mockERC20.approve(king.address, underlyingExchanged.mul(2))).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();

      await mine(5);

      king.connect(eoa1).redeemVestings(deployer.address);

      expect(await wusd.balanceOf(eoa1.address)).to.equal(ethers.BigNumber.from(0));
    });

    it('Should vest 10% and redeem them after 5 blocks', async () => {
      const { deployer, king, wusd, mockERC20, usdtOracle } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);
      const vestingCreated = mintAmount.mul((await king.reserves(mockERC20.address)).mintingInterestRate).div(10000);

      await (await mockERC20.approve(king.address, underlyingExchanged.mul(2))).wait();

      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();
      expect((await king.vestings(deployer.address, 0)).unlockPeriod).to.be.equal(
        (await ethers.provider.getBlockNumber()) + 5,
      );

      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();
      expect((await king.vestings(deployer.address, 1)).unlockPeriod).to.be.equal(
        (await ethers.provider.getBlockNumber()) + 5,
      );

      expect((await king.vestings(deployer.address, 0)).amount).to.be.equal(vestingCreated);
      expect((await king.vestings(deployer.address, 1)).amount).to.be.equal(vestingCreated);

      await mine(5);

      await expect(king.redeemVestings(deployer.address))
        .to.emit(wusd, 'Transfer')
        .withArgs('0x'.padEnd(42, '0'), deployer.address, vestingCreated.mul(2))
        .and.to.emit(king, 'VestingRedeem')
        .withArgs(deployer.address, vestingCreated.mul(2));

      expect(await wusd.balanceOf(deployer.address)).to.equal(mintAmount.mul(2));
    });

    it('Should remove vesting infos after redeem', async () => {
      const { deployer, king, wusd, mockERC20, usdtOracle } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);

      await (await mockERC20.approve(king.address, underlyingExchanged.mul(2))).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();

      await mine(5);

      await (await king.redeemVestings(deployer.address)).wait();

      const vestingInfos = await king.getVestingInfos(deployer.address);

      const bigZero = ethers.BigNumber.from(0);
      expect(vestingInfos.redeemable).to.be.equal(bigZero);
      expect(vestingInfos.numOfVestings).to.be.equal(bigZero);
    });
  });

  describe('reprove', () => {
    it("Should fail if the reserve doesn't exists", async () => {
      const { deployer, king, mockERC20 } = await getAddresses();
      await expect(king.praise(mockERC20.address, deployer.address, 1)).to.be.revertedWith(
        "King: reserve doesn't exists",
      );
    });

    it('Should fail if the reserve is disabled', async () => {
      const { king, mockERC20, usdtOracle } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address, true);

      await expect(king.reprove(mockERC20.address, 1)).to.be.revertedWith('King: reserve disabled');
    });

    it('Should fail if the reserve is not whitelisted for reproval', async () => {
      const { king, mockERC20, usdtOracle } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address, false, false);

      await expect(king.reprove(mockERC20.address, 1)).to.be.revertedWith('King: reserve not whitelisted for reproval');
    });

    it('Should burn 0.9 $WUSD, send 0.8 $MockERC20 to reprover and 0.1 $WUSD to sWagme', async () => {
      const { deployer, king, wusd, mockERC20, usdtOracle, sWagmeKingdom, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const toBeExchanged = await usdtOracle.getExchangeRate(mintAmount);

      await (await mockERC20.approve(king.address, toBeExchanged)).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();

      const vestingAmount = mintAmount.mul((await king.reserves(mockERC20.address)).mintingInterestRate).div(10000);
      const burnAmount = mintAmount.sub(vestingAmount);
      const sWagmeTax = burnAmount.mul(await king.sWagmeTaxRate()).div(10000);
      const trueBurnAmountAfterTax = burnAmount.sub(sWagmeTax);
      const reproveReserveExchangedAmount = await king.conversionRateFUSDToReserve(
        mockERC20.address,
        trueBurnAmountAfterTax,
      );

      // We set the balance of reprover to 0 before reprove() to compute assert easily
      await (await mockERC20.transfer(eoa1.address, await mockERC20.balanceOf(deployer.address))).wait();

      await (await wusd.approve(king.address, burnAmount)).wait();
      await expect(king.reprove(mockERC20.address, burnAmount))
        // Burn WUSD
        .to.emit(wusd, 'Transfer')
        .withArgs(deployer.address, '0x'.padEnd(42, '0'), trueBurnAmountAfterTax)
        // Transfer WUSD to sWagme
        .and.to.emit(wusd, 'Transfer')
        .withArgs(deployer.address, sWagmeKingdom.address, sWagmeTax)
        // Transfer reserve to account
        .and.to.emit(mockERC20, 'Transfer')
        .withArgs(king.address, deployer.address, reproveReserveExchangedAmount)
        // Emit King reprove
        .and.to.emit(king, 'Reprove')
        .withArgs(mockERC20.address, deployer.address, burnAmount);

      // Check WUSD balance of reprover
      expect(await wusd.balanceOf(deployer.address)).to.be.equal(
        ethers.BigNumber.from(0),
        '$WUSD balance of reprover not 0',
      );

      // Check WUSD balance of sWagme
      expect(await wusd.balanceOf(sWagmeKingdom.address)).to.be.equal(
        sWagmeTax,
        '$WUSD balance of sWagme to be sWagmeTax',
      );

      // Check MockERC20 balance of reprover
      expect(await mockERC20.balanceOf(deployer.address)).to.be.equal(
        reproveReserveExchangedAmount,
        '$MockERC20 balance of reprover to be underlyingExchanged',
      );
    });
  });

  describe('withdrawFreeReserve', () => {
    it('Should be called only by crown', async () => {
      const { deployer, king, mockERC20, mockERC20_2, usdtOracle, eoa1 } = await getAddresses();

      await expect(
        king.connect(eoa1).withdrawFreeReserve(mockERC20.address, eoa1.address, ethers.utils.parseEther('1')),
      ).to.be.revertedWith('King: Only crown can execute');
    });

    it('Should revert if freeReserve exceeded', async () => {
      const { deployer, king, mockERC20, usdtOracle, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);

      await (await mockERC20.approve(king.address, underlyingExchanged)).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();

      await expect(king.withdrawFreeReserve(mockERC20.address, eoa1.address, mintAmount)).to.be.revertedWith(
        'King: max amount exceeded',
      );
    });

    it('Should withdraw only the specified freeReserve', async () => {
      const { deployer, king, mockERC20, mockERC20_2, usdtOracle, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);
      await addReserve(king, mockERC20_2.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);
      const expectedFreeReserveAddedInFUSD = mintAmount
        .mul((await king.reserves(mockERC20.address)).burningTaxRate)
        .div(10000);
      const expectedFreeReserveWithdrawn = await king.conversionRateFUSDToReserve(
        mockERC20.address,
        expectedFreeReserveAddedInFUSD,
      );

      await (await mockERC20.approve(king.address, underlyingExchanged)).wait();
      await (await mockERC20_2.approve(king.address, underlyingExchanged)).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();
      await (await king.praise(mockERC20_2.address, deployer.address, mintAmount)).wait();

      await expect(king.withdrawFreeReserve(mockERC20.address, eoa1.address, expectedFreeReserveAddedInFUSD)).to.not.be
        .reverted;

      expect(await mockERC20.balanceOf(eoa1.address)).to.be.equal(expectedFreeReserveWithdrawn);
      expect(await mockERC20_2.balanceOf(eoa1.address)).to.be.equal(ethers.BigNumber.from(0));

      expect(await king.freeReserves(mockERC20.address)).to.be.equal(ethers.BigNumber.from(0));
      expect(await king.freeReserves(mockERC20_2.address)).to.be.equal(expectedFreeReserveAddedInFUSD);
    });
  });

  describe('withdrawReserve', () => {
    it('Should only let the crown execute', async () => {
      const { deployer, king, mockERC20, usdtOracle, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);

      await (await mockERC20.approve(king.address, underlyingExchanged)).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();

      await expect(
        king.connect(eoa1).withdrawReserve(mockERC20.address, eoa1.address, underlyingExchanged),
      ).to.be.revertedWith('King: Only crown can execute');
    });

    it("Should fail if the reserve doesn't exists", async () => {
      const { king, mockERC20, usdtOracle, eoa1 } = await getAddresses();

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);

      await expect(king.withdrawReserve(mockERC20.address, eoa1.address, underlyingExchanged)).to.be.revertedWith(
        "King: reserve doesn't exists",
      );
    });

    it('Should withdraw 1.1 $MockERC20 to eoa1', async () => {
      const { deployer, king, mockERC20, usdtOracle, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);

      await (await mockERC20.approve(king.address, underlyingExchanged)).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();

      await expect(king.withdrawReserve(mockERC20.address, eoa1.address, underlyingExchanged))
        .to.emit(mockERC20, 'Transfer')
        .withArgs(king.address, eoa1.address, underlyingExchanged)
        .and.to.emit(king, 'WithdrawReserve')
        .withArgs(mockERC20.address, eoa1.address, underlyingExchanged);

      expect(await king.freeReserves(mockERC20.address)).to.be.equal(ethers.BigNumber.from(0));
      expect(await mockERC20.balanceOf(eoa1.address)).to.be.equal(underlyingExchanged);
    });

    it('Should not fail if the reserve is disabled', async () => {
      const { deployer, king, mockERC20, usdtOracle, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);

      await (await mockERC20.approve(king.address, underlyingExchanged)).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();

      // Disable already created reserve
      await addReserve(king, mockERC20.address, usdtOracle.address, true);

      await expect(king.withdrawReserve(mockERC20.address, eoa1.address, underlyingExchanged)).to.not.be.reverted;
    });

    it('Should reset freeReserve upon withdrawal', async () => {
      const { deployer, king, mockERC20, mockERC20_2, usdtOracle, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);
      await addReserve(king, mockERC20_2.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);
      const expectedFreeReserveAddedInFUSD = mintAmount
        .mul((await king.reserves(mockERC20.address)).burningTaxRate)
        .div(10000);

      await (await mockERC20.approve(king.address, underlyingExchanged)).wait();
      await (await mockERC20_2.approve(king.address, underlyingExchanged)).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();
      await (await king.praise(mockERC20_2.address, deployer.address, mintAmount)).wait();

      await (await king.withdrawReserve(mockERC20.address, eoa1.address, underlyingExchanged)).wait();

      expect(await king.freeReserves(mockERC20.address)).to.be.equal(ethers.BigNumber.from(0));
      expect(await king.freeReserves(mockERC20_2.address)).to.be.equal(expectedFreeReserveAddedInFUSD);
    });
  });

  describe('withdrawAll', () => {
    it('Should only let the crown execute', async () => {
      const { deployer, king, mockERC20, usdtOracle, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const mockERC20_2 = await (await ethers.getContractFactory('MockERC20')).deploy(ethers.utils.parseEther('10'));
      const usdtOracle2 = await (await ethers.getContractFactory('KingReserveUSDTOracle')).deploy();
      await addReserve(king, mockERC20_2.address, usdtOracle2.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);

      await (await mockERC20.approve(king.address, underlyingExchanged)).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();

      await (await mockERC20_2.approve(king.address, underlyingExchanged)).wait();
      await (await king.praise(mockERC20_2.address, deployer.address, mintAmount)).wait();

      await expect(king.connect(eoa1).withdrawAll(eoa1.address)).to.be.revertedWith('King: Only crown can execute');
    });

    it("Should send 0 if the reserve doesn't exists", async () => {
      const { king, eoa1 } = await getAddresses();

      await expect(king.withdrawAll(eoa1.address)).to.not.be.reverted;
    });

    it('Should withdraw 2.2 $MockERC20 to eoa1', async () => {
      const { deployer, king, mockERC20, mockERC20_2, usdtOracle, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);
      await addReserve(king, mockERC20_2.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);

      await (await mockERC20.approve(king.address, underlyingExchanged)).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();

      await (await mockERC20_2.approve(king.address, underlyingExchanged)).wait();
      await (await king.praise(mockERC20_2.address, deployer.address, mintAmount)).wait();

      await expect(king.withdrawAll(eoa1.address))
        .to.emit(mockERC20, 'Transfer')
        .withArgs(king.address, eoa1.address, underlyingExchanged)
        .to.emit(mockERC20_2, 'Transfer')
        .withArgs(king.address, eoa1.address, underlyingExchanged)
        .and.to.emit(king, 'WithdrawReserve')
        .withArgs(mockERC20.address, eoa1.address, underlyingExchanged)
        .and.to.emit(king, 'WithdrawReserve')
        .withArgs(mockERC20_2.address, eoa1.address, underlyingExchanged);

      expect(await mockERC20.balanceOf(eoa1.address)).to.be.equal(underlyingExchanged);
      expect(await mockERC20_2.balanceOf(eoa1.address)).to.be.equal(underlyingExchanged);
    });

    it('Should not fail if the reserve is disabled', async () => {
      const { deployer, king, mockERC20, usdtOracle, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);

      await (await mockERC20.approve(king.address, underlyingExchanged)).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();

      // Disable already created reserve
      await addReserve(king, mockERC20.address, usdtOracle.address, true);

      await expect(king.withdrawAll(eoa1.address)).to.not.be.reverted;
    });

    it('Should reset all freeReserve upon withdrawal', async () => {
      const { deployer, king, mockERC20, mockERC20_2, usdtOracle, eoa1 } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);
      await addReserve(king, mockERC20_2.address, usdtOracle.address);

      const mintAmount = ethers.utils.parseEther('1');
      const underlyingExchanged = await usdtOracle.getExchangeRate(mintAmount);

      await (await mockERC20.approve(king.address, underlyingExchanged)).wait();
      await (await mockERC20_2.approve(king.address, underlyingExchanged)).wait();
      await (await king.praise(mockERC20.address, deployer.address, mintAmount)).wait();
      await (await king.praise(mockERC20_2.address, deployer.address, mintAmount)).wait();

      await (await king.withdrawAll(eoa1.address)).wait();

      expect(await king.freeReserves(mockERC20.address)).to.be.equal(ethers.BigNumber.from(0));
      expect(await king.freeReserves(mockERC20_2.address)).to.be.equal(ethers.BigNumber.from(0));
    });
  });

  describe('conversionRateFUSDToReserve', () => {
    it("Should fail if the reserve doesn't exist", async () => {
      const { king, mockERC20 } = await getAddresses();

      await expect(king.conversionRateFUSDToReserve(mockERC20.address, 1)).to.be.revertedWith(
        "King: reserve doesn't exists",
      );
    });

    it('Should output the correct amount', async () => {
      const { king, mockERC20, usdtOracle } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      expect(await king.conversionRateFUSDToReserve(mockERC20.address, 1)).to.be.equal(
        await usdtOracle.getExchangeRate(1),
      );
    });
  });

  describe('conversionRateReserveToFUSD', () => {
    it("Should fail if the reserve doesn't exist", async () => {
      const { king, mockERC20 } = await getAddresses();

      await expect(king.conversionRateReserveToFUSD(mockERC20.address, 1)).to.be.revertedWith(
        "King: reserve doesn't exists",
      );
    });

    it('Should output the correct amount', async () => {
      const { king, mockERC20, usdtOracle } = await getAddresses();
      await addReserve(king, mockERC20.address, usdtOracle.address);

      expect(await king.conversionRateReserveToFUSD(mockERC20.address, 11)).to.be.equal(ethers.BigNumber.from(10));
    });
  });

  describe('crownKing', () => {
    it('Crown can be changed only by the current crown', async () => {
      const { king, eoa1 } = await getAddresses();

      await expect(king.connect(eoa1).crownKing(eoa1.address)).to.be.revertedWith('King: Only crown can execute');

      await expect(king.crownKing(eoa1.address)).to.not.be.reverted;

      expect(await king.crown()).to.equal(eoa1.address);
    });
  });
});

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
  const wusd = await (await ethers.getContractFactory('WUSD')).deploy(deployer.address);
  await wusd.deployed();

  const usdtOracle = await (await ethers.getContractFactory('KingReserveUSDTOracle')).deploy();

  const eoa1 = new ethers.Wallet(ethers.Wallet.createRandom().privateKey, ethers.provider);
  await setBalance(eoa1.address, 100000);

  return {
    deployer,
    wusd,
    usdtOracle,
    eoa1,
  };
};

describe('King', () => {
  it('Can be minted only by the owner', async () => {
    const { wusd, eoa1 } = await getAddresses();
    await expect(wusd.connect(eoa1).mint(eoa1.address, 1)).to.be.revertedWith('WUSD: Only king is authorized');

    await expect(wusd.mint(eoa1.address, 1)).to.not.be.reverted;
    expect(await wusd.balanceOf(eoa1.address)).to.equal(ethers.BigNumber.from(1));
  });

  it("Can't change owner if not by him", async () => {
    const { deployer, wusd, eoa1 } = await getAddresses();
    await expect(wusd.connect(eoa1).claimCrown(eoa1.address)).to.be.revertedWith('WUSD: Only king is authorized');

    await expect(wusd.claimCrown(eoa1.address)).to.not.be.reverted;
    expect(await wusd.king()).to.equal(eoa1.address);
  });
});

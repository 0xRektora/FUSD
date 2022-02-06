import hre, { ethers } from 'hardhat';

async function main() {
  await hre.run('deploy', { tags: 'KingReserveUSTOracle' });
  await hre.run('deploy', { tags: 'KingReserveFRAXOracle' });
  await hre.run('deploy', { tags: 'KingReserveUSDCOracle' });
  await hre.run('deploy', { tags: 'KingReserveDAIOracle' });
  await hre.run('deploy', { tags: 'KingReserveUSDTOracle' });

  const deployments = hre.deployments;
  const USTOracle = await deployments.get('KingReserveUSTOracle');
  const FRAXOracle = await deployments.get('KingReserveFRAXOracle');
  const USDCOracle = await deployments.get('KingReserveUSDCOracle');
  const DAIOracle = await deployments.get('KingReserveDAIOracle');
  const USDTOracle = await deployments.get('KingReserveUSDTOracle');

  const king = await hre.ethers.getContractAt('King', '0xF531FfF3BDF241Bd361C8531882faEFeDd594f26');
  const sFrg = '0x7Ea6E87789C40084030b2289C89fdA723Bd91117'; // Takes 10% burning tax
  await (await king.updateSFrgKingdom(sFrg)).wait();

  const mintingInterestRateInBps = 1000;
  const burningTaxRateInBps = 2000;
  const vestingPeriodInBlocks = (60 * 60 * 24 * 30 * 6) / 2; // 6 months (FTM => 1 block = 2sec)
  const isDisabled = false;
  const isReproveWhitelistedTrue = true;
  const isReproveWhitelistedFalse = false;
  const sFrgTaxRate = 1000;

  // UST
  const USTAddr = '0xe2d27f06f63d98b8e11b38b5b08a75d0c8dd62b9';
  await (
    await king.bless(
      USTAddr,
      mintingInterestRateInBps,
      burningTaxRateInBps,
      vestingPeriodInBlocks,
      USTOracle.address,
      isDisabled,
      isReproveWhitelistedTrue,
      sFrgTaxRate,
    )
  ).wait();

  // FRAX
  const FRAXAddr = '0xdc301622e621166bd8e82f2ca0a26c13ad0be355';
  await (
    await king.bless(
      FRAXAddr,
      mintingInterestRateInBps,
      burningTaxRateInBps,
      vestingPeriodInBlocks,
      FRAXOracle.address,
      isDisabled,
      isReproveWhitelistedTrue,
      sFrgTaxRate,
    )
  ).wait();

  // USDC
  const USDCAddr = '0x04068da6c83afcfa0e13ba15a6696662335d5b75';
  await (
    await king.bless(
      USDCAddr,
      mintingInterestRateInBps,
      burningTaxRateInBps,
      vestingPeriodInBlocks,
      USDCOracle.address,
      isDisabled,
      isReproveWhitelistedFalse,
      sFrgTaxRate,
    )
  ).wait();

  // DAI
  const DAIAddr = '0x8d11ec38a3eb5e956b052f67da8bdc9bef8abf3e';
  await (
    await king.bless(
      DAIAddr,
      mintingInterestRateInBps,
      burningTaxRateInBps,
      vestingPeriodInBlocks,
      DAIOracle.address,
      isDisabled,
      isReproveWhitelistedFalse,
      sFrgTaxRate,
    )
  ).wait();

  // USDT
  const USDTAddr = '0x049d68029688eabf473097a2fc38ef61633a3c7a';
  await (
    await king.bless(
      USDTAddr,
      mintingInterestRateInBps,
      burningTaxRateInBps,
      vestingPeriodInBlocks,
      USDTOracle.address,
      isDisabled,
      isReproveWhitelistedFalse,
      sFrgTaxRate,
    )
  ).wait();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

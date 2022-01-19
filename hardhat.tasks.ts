import { task } from 'hardhat/config';
import '@nomiclabs/hardhat-ethers';

task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

task('run-mainnet-test', 'Open allowance', async (taskArgs, hre) => {
  const king = await hre.ethers.getContractAt('King', (await hre.deployments.get('King')).address);
  const fusd = await hre.ethers.getContractAt('FUSD', (await hre.deployments.get('FUSD')).address);
  const mim = await hre.ethers.getContractAt('ERC20', '0x82f0B8B456c1A451378467398982d4834b6829c1');

  const eth = hre.ethers.utils.parseEther('1');

  await (await fusd.approve(king.address, eth)).wait();
  await (await mim.approve(king.address, eth)).wait();
});

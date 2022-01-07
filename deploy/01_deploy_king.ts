import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const wusd = await hre.ethers.getContractAt('WUSD', (await deployments.get('WUSD')).address);
  const sWagmeAddress = '0x'.padEnd(42, '0');
  const sWagmeTaxRate = '5000'; // In Bps

  const args = [wusd.address, sWagmeAddress, sWagmeTaxRate];
  await deploy('King', {
    from: deployer,
    log: true,
    args,
  });

  // Set WUSD king
  const king = await hre.ethers.getContractAt('King', (await deployments.get('King')).address);
  await (await wusd.claimCrown(king.address)).wait();

  // Set sWagmeKingdom to king
  await (await king.updateSWagmeKingdom(king.address)).wait();

  if (hre.network.name === 'mainnet') {
    try {
      await hre.run('verify', { network: 'mainnet', address: king.address, constructorArgsParams: args });
    } catch (err) {
      console.log(err);
    }
  }
};
export default func;
func.dependencies = ['WUSD'];
func.tags = ['King'];

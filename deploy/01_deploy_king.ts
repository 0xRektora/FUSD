import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const fusd = await hre.ethers.getContractAt('FUSD', (await deployments.get('FUSD')).address);
  const sWagmeAddress = '0x'.padEnd(42, '0');

  const args = [fusd.address, sWagmeAddress];
  await deploy('King', {
    waitConfirmations: hre.network.live ? 12 : 1,
    gasPrice: (await hre.ethers.provider.getGasPrice()).mul(2),
    from: deployer,
    log: true,
    args,
  });

  // Set FUSD king
  const king = await hre.ethers.getContractAt('King', (await deployments.get('King')).address);
  await (await fusd.claimCrown(king.address)).wait();

  if (hre.network.live) {
    try {
      await hre.run('verify', { network: 'mainnet', address: king.address, constructorArgsParams: args });
    } catch (err) {
      console.log(err);
    }
  }
};
export default func;
func.dependencies = ['FUSD'];
func.tags = ['King'];

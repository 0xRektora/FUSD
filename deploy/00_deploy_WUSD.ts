import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  await deploy('WUSD', {
    from: deployer,
    log: true,
    args: [deployer],
  });

  if (hre.network.name === 'mainnet') {
    try {
      const wusd = await deployments.get('WUSD');
      await hre.run('verify', { network: 'mainnet', address: wusd.address, constructorArgsParams: [deployer] });
    } catch (err) {
      console.log(err);
    }
  }
};
export default func;
func.tags = ['WUSD'];

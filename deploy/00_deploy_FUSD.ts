import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  await deploy('FUSD', {
    from: deployer,
    log: true,
    args: [deployer],
  });

  if (hre.network.name === 'mainnet') {
    try {
      const fusd = await deployments.get('FUSD');
      await hre.run('verify', { network: 'mainnet', address: fusd.address, constructorArgsParams: [deployer] });
    } catch (err) {
      console.log(err);
    }
  }
};
export default func;
func.tags = ['FUSD'];

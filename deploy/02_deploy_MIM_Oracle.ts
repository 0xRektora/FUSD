import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  await deploy('KingReserveMIMOracle', {
    from: deployer,
    log: true,
  });

  if (hre.network.name === 'mainnet') {
    try {
      const oracle = await deployments.get('KingReserveMIMOracle');
      await hre.run('verify', { network: 'mainnet', address: oracle.address });
    } catch (err) {
      console.log(err);
    }
  }
};
export default func;
func.tags = ['KingReserveMIMOracle'];

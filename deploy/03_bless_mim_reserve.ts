import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const mimAddr = '0x82f0B8B456c1A451378467398982d4834b6829c1';

  const king = await hre.ethers.getContractAt('King', (await deployments.get('King')).address);
  const oracle = await hre.ethers.getContractAt(
    'KingReserveMIMOracle',
    (await deployments.get('KingReserveMIMOracle')).address,
  );

  await (await king.bless(mimAddr, 1000, 2000, 5, oracle.address, false, true, 5000)).wait();
};
export default func;
func.dependencies = ['FUSD', 'King', 'KingReserveMIMOracle'];

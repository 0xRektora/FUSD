import * as dotenv from 'dotenv';

import { HardhatUserConfig } from 'hardhat/config';
import '@nomiclabs/hardhat-waffle';
import '@typechain/hardhat';
import '@nomiclabs/hardhat-etherscan';
import 'hardhat-deploy';
import '@nomiclabs/hardhat-ethers';
import 'hardhat-gas-reporter';
import 'solidity-coverage';

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.4',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  namedAccounts: {
    deployer: 0,
  },
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      accounts:
        process.env.PRIVATE_KEY !== undefined
          ? [
              {
                privateKey: process.env.PRIVATE_KEY,
                balance: '1000000000000000000000000',
              },
            ]
          : [],
    },
    mainnet: {
      gasMultiplier: 2,
      live: true,
      url: process.env.MAINNET || '',
      chainId: Number(process.env.CHAIN_ID || 1),
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: process.env.BLOCKSCAN_KEY,
  },
  gasReporter: {
    currency: 'USD',
    token: 'FTM',
    coinmarketcap: process.env.COINMARKETCAP_API ?? '',
  },
};

export default config;

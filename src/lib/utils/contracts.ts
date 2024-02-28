import type {
	NetworkConfigs,
	MultiNetworkConfigs,
	SingleNetworkConfig,
	GenericContractsInfos,
} from '$lib/stores/types';
import { formatChainId, toHex } from './ethereum';

export function getSingleNetworkConfig<
	NetworkConfig extends NetworkConfigs<ContractsInfos>,
	ContractsInfos extends GenericContractsInfos,
>(networkConfigs: NetworkConfig, chainId: string): SingleNetworkConfig<ContractsInfos> | undefined {
	if ('chainId' in networkConfigs && networkConfigs.chainId) {
		const networkConfig = networkConfigs as SingleNetworkConfig<ContractsInfos>;

		if (chainId === networkConfig.chainId || chainId == formatChainId(networkConfig.chainId)) {
			return networkConfig;
		} else {
			return undefined;
		}
	} else {
		const multinetworkConfigs = networkConfigs as unknown as MultiNetworkConfigs<ContractsInfos>;
		const networkConfig =
			multinetworkConfigs.chains[chainId] || multinetworkConfigs.chains[toHex(chainId)];
		if (!networkConfig) {
			return undefined;
		} else {
			return networkConfig;
		}
	}
}

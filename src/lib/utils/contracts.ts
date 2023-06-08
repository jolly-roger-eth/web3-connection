import type {
	NetworkConfigs,
	MultiNetworkConfigs,
	SingleNetworkConfig,
	GenericContractsInfos,
} from '$lib/stores/connection';
import { formatChainId, toHex } from './ethereum';

export function getContractInfos<N extends SingleNetworkConfig<GenericContractsInfos>>(
	networkConfigs: NetworkConfigs<N['contracts']>,
	chainId: string
): N['contracts'] | undefined {
	if ('chainId' in networkConfigs && networkConfigs.chainId) {
		const networkConfig = networkConfigs as N;

		if (chainId === networkConfig.chainId || chainId == formatChainId(networkConfig.chainId)) {
			return networkConfig.contracts;
		} else {
			return undefined;
		}
	} else {
		const multinetworkConfigs = networkConfigs as unknown as MultiNetworkConfigs<N['contracts']>;
		const networkConfig =
			multinetworkConfigs.chains[chainId] || multinetworkConfigs.chains[toHex(chainId)];
		if (!networkConfig) {
			return undefined;
		} else {
			return networkConfig.contracts;
		}
	}
}

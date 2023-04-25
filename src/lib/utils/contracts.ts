import type {
	NetworkConfigs,
	MultiNetworkConfigs,
	GenericNetworkConfig,
} from '$lib/stores/connection';
import { formatChainId, toHex } from './ethereum';

export function getContractInfos<N extends GenericNetworkConfig>(
	networkConfigs: NetworkConfigs<N>,
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
		const multinetworkConfigs = networkConfigs as MultiNetworkConfigs<N>;
		const networkConfig =
			multinetworkConfigs.chains[chainId] || multinetworkConfigs.chains[toHex(chainId)];
		if (!networkConfig) {
			return undefined;
		} else {
			return networkConfig.contracts;
		}
	}
}

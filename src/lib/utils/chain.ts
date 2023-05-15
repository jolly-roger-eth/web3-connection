import type { EIP1193ProviderWithoutEvents } from 'eip-1193';

export async function checkGenesis(
	provider: EIP1193ProviderWithoutEvents,
	chainId: string
): Promise<{ changed: boolean; hash: string } | undefined> {
	let networkChanged = undefined;
	try {
		const lkey = `_genesis_${chainId}`;
		const genesisBlock = await provider.request({
			method: 'eth_getBlockByNumber',
			params: [`earliest`, false],
		});
		const lastHash = localStorage.getItem(lkey);
		if (lastHash !== genesisBlock.hash) {
			if (lastHash) {
				networkChanged = true;
			} else {
				networkChanged = false;
				localStorage.setItem(lkey, genesisBlock.hash);
			}
		} else {
			networkChanged = false;
		}
		return { changed: networkChanged, hash: genesisBlock.hash };
	} catch {
		return undefined;
	}
}

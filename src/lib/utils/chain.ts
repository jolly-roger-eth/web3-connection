import type { EIP1193Block, EIP1193ProviderWithoutEvents } from 'eip-1193';

export async function checkGenesis(
	provider: EIP1193ProviderWithoutEvents,
	chainId: string,
	rpcURL?: string
): Promise<{ changed: boolean; hash: string } | undefined> {
	let networkChanged = undefined;
	try {
		const lkey = `_genesis_${chainId}`;
		let genesisBlock: EIP1193Block | undefined;

		// we fetch from the provider
		// this might cache it
		const genesisBlockFromProvider = await provider.request({
			method: 'eth_getBlockByNumber',
			params: [`earliest`, false],
		});
		if (rpcURL) {
			// if we provide an url, we also fetch from there
			const response = await fetch(rpcURL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					id: Date.now(),
					jsonrpc: '2.0',
					method: 'eth_getBlockByNumber',
					params: [`earliest`, false],
				}),
			}).then((response) => response.json());
			// and use the result
			genesisBlock = response.result;

			if (genesisBlock && genesisBlockFromProvider.hash !== genesisBlock.hash) {
				console.log(`different genesis returned from the provider: it has cahced the result`);
			}
		} else {
			genesisBlock = genesisBlockFromProvider;
		}

		if (genesisBlock) {
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
		}
		return undefined;
	} catch {
		return undefined;
	}
}

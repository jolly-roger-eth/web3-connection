import type { EIP1193ProviderWithoutEvents } from 'eip-1193';

export async function checkGenesis(
	provider: EIP1193ProviderWithoutEvents | string,
	chainId: string
): Promise<{ changed: boolean; hash: string } | undefined> {
	let networkChanged = undefined;
	try {
		const lkey = `_genesis_${chainId}`;
		let genesisBlock;
		if (typeof provider === 'string') {
			try {
				const response = await fetch(provider, {
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

				genesisBlock = response.result;
			} catch {}
		} else {
			genesisBlock = await provider.request({
				method: 'eth_getBlockByNumber',
				params: [`earliest`, false],
			});
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

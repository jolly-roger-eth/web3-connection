import type { EIP1193Block, EIP1193ProviderWithoutEvents } from 'eip-1193';
import { logs } from 'named-logs';

const logger = logs('web3-connection:chains');

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
				console.error(
					`different genesis returned from the provider: it has cached the result and need to be reset`
				);
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

export async function isNonceCached(
	address: `0x${string}`,
	provider: EIP1193ProviderWithoutEvents,
	rpcURL: string
) {
	// we fetch nonce from different address format due to https://github.com/MetaMask/metamask-extension/issues/19183
	const nonceFromProviderLowerCase = await provider
		.request({
			method: 'eth_getTransactionCount',
			params: [address.toLowerCase() as `0x${string}`, 'pending'],
		})
		.then((v) => (typeof v === 'string' ? parseInt(v.slice(2), 16) : v));
	const nonceFromProviderUpperCase = await provider
		.request({
			method: 'eth_getTransactionCount',
			params: [(`0x` + address.slice(2).toUpperCase()) as `0x${string}`, 'pending'],
		})
		.then((v) => (typeof v === 'string' ? parseInt(v.slice(2), 16) : v));

	logger.info({
		nonceFromProviderLowerCase,
		nonceFromProviderUpperCase,
	});
	const nonceFromNode = await fetch(rpcURL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			id: Date.now(),
			jsonrpc: '2.0',
			method: 'eth_getTransactionCount',
			params: [address, 'pending'],
		}),
	})
		.then((response) => response.json())
		.then((response) => (response.result ? parseInt(response.result.slice(2), 16) : null));
	return (
		nonceFromNode !== null &&
		(nonceFromNode < nonceFromProviderUpperCase || nonceFromNode < nonceFromProviderLowerCase)
	);
}

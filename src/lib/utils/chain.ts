import type { EIP1193Block, EIP1193ProviderWithoutEvents } from 'eip-1193';
import { logs } from 'named-logs';

const logger = logs('web3-connection:chains');

export async function checkGenesis(
	provider: EIP1193ProviderWithoutEvents,
	rpcURL: string
): Promise<{ matching: boolean; hash: string }> {
	// we fetch from the provider
	// this might cache it
	const genesisBlockFromProvider = await provider.request({
		method: 'eth_getBlockByNumber',
		params: [`earliest`, false],
	});
	// we then fetch from node to compare with
	const genesisBlockFromNode = await fetch(rpcURL, {
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
	})
		.then((response) => response.json())
		.then((response) => response.result);

	const matching = genesisBlockFromProvider.hash === genesisBlockFromNode.hash;
	if (!matching) {
		console.error(
			`different genesis returned from the provider: it most likely has cached the result and need to be reset`
		);
	}

	return { matching, hash: genesisBlockFromNode.hash };
}

export type NonceCachedStatus = 'cache' | 'BlockOutOfRangeError' | false;

export async function isNonceCached(
	address: `0x${string}`,
	provider: EIP1193ProviderWithoutEvents,
	rpcURL: string
): Promise<NonceCachedStatus | undefined> {
	let nonceFromProviderLowerCase: number | undefined;
	try {
		// we fetch nonce from different address format due to https://github.com/MetaMask/metamask-extension/issues/19183
		nonceFromProviderLowerCase = await provider
			.request({
				method: 'eth_getTransactionCount',
				params: [address.toLowerCase() as `0x${string}`, 'pending'],
			})
			.then((v) => (typeof v === 'string' ? parseInt(v.slice(2), 16) : v));
	} catch (err: any) {
		if (err.code === -32603 && err.message.indexOf('BlockOutOfRangeError') >= 0) {
			return 'BlockOutOfRangeError';
		}
		console.error(`failed to get lowercase account's nonce from provider`, err);
	}
	let nonceFromProvider: number | undefined;
	try {
		nonceFromProvider = await provider
			.request({
				method: 'eth_getTransactionCount',
				params: [address, 'pending'],
			})
			.then((v) => (typeof v === 'string' ? parseInt(v.slice(2), 16) : v));
	} catch (err: any) {
		if (err.code === -32603 && err.message.indexOf('BlockOutOfRangeError') >= 0) {
			return 'BlockOutOfRangeError';
		}
		console.error(`failed to get account's nonce from provider`, err);
	}

	let nonceFromNode: number | undefined;
	try {
		nonceFromNode = await fetch(rpcURL, {
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
			.then((response) => (response.result ? parseInt(response.result.slice(2), 16) : undefined));
	} catch (err) {
		console.error(`failed to get account's nonce from node: ${rpcURL}`, err);
	}

	logger.info({
		nonceFromNode,
		nonceFromProviderLowerCase,
		nonceFromProvider,
	});

	if (
		nonceFromNode === undefined ||
		nonceFromProvider === undefined ||
		nonceFromProviderLowerCase === undefined
	) {
		return undefined;
	}

	return nonceFromNode < nonceFromProvider || nonceFromNode < nonceFromProviderLowerCase
		? 'cache'
		: false;
}

export function hasTrackedGenesisChanged(chainId: string, genesisHash: string): boolean {
	try {
		const key = `_genesis_${chainId}`;
		const previous = localStorage.getItem(key);
		if (previous) {
			if (previous !== genesisHash) {
				console.warn(`network reset detected`);
				return true;
			}
		} else {
			localStorage.setItem(key, genesisHash);
		}
	} catch {}
	return false;
}

export function recordNewGenesis(chainId: string, genesisHash: string): boolean {
	try {
		const key = `_genesis_${chainId}`;
		localStorage.setItem(key, genesisHash);
	} catch {}
	return false;
}

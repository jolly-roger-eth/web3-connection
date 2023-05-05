import type { EIP1193Provider, EIP1193ProviderWithoutEvents, EIP1193Request } from 'eip-1193';
// import { createBlockPoller, createSubscriptionHandler } from './subscriptions';

export type DefaultProvider = EIP1193Provider & {
	fallbackOn(provider: EIP1193ProviderWithoutEvents | undefined): void;
	chainId: string;
	clearSubscriptions(): void;
	stopPolling(): void;
};

let counter = 0;
export function createRPCProvider(config: { chainId: string; url: string }): DefaultProvider {
	const url = config.url;
	const chainIdExpected = config.chainId;
	let _fallbackProvider: EIP1193ProviderWithoutEvents | undefined;

	let chainIdPromise: Promise<string> | undefined;
	async function request(args: EIP1193Request) {
		if (chainIdPromise) {
			await chainIdPromise;
		}

		switch (args.method) {
			case 'eth_requestAccounts':
			case 'eth_sendTransaction':
			case 'eth_sign':
			case 'eth_signTransaction':
			case 'eth_signTypedData':
			case 'eth_signTypedData_v4':
			case 'personal_sign':
			case 'wallet_addEthereumChain':
			case 'wallet_switchEthereumChain':
				throw new Error(`${args.method} not available on read-only RPC providers.`);
			case 'eth_subscribe':
				// if (subscriptionHandler) {
				// 	return subscriptionHandler.handleSubscriptionRequest(args);
				// }
				throw new Error(`subscriptions are not available`);
			case 'eth_unsubscribe':
				// if (subscriptionHandler) {
				// 	return subscriptionHandler.handleUnSubscriptionRequest(args);
				// }
				throw new Error(`subscriptions are not available`);
		}
		if (_fallbackProvider) {
			return _fallbackProvider.request(args);
		}
		return fetch(url, {
			method: 'POST',
			cache: 'no-cache',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: ++counter,
				method: args.method,
				params: 'params' in args ? args.params : undefined,
			}),
		})
			.then((v) => v.json())
			.then((v) => {
				if (v.error) {
					if (v.error.message || v.error.data?.message) {
						throw new Error(v.error.message || v.error.data?.message, {
							cause: { code: v.error.code, data: v.error.data },
						});
					} else {
						throw new Error(v.error, { cause: { code: v.error.code, data: v.error.data } });
					}
				}
				return v.result;
			});
	}

	chainIdPromise = request({ method: 'eth_chainId' });
	chainIdPromise.then((v) => {
		const chainId = parseInt(v.slice(2), 16).toString();
		if (chainId !== chainIdExpected) {
			throw new Error(`unexpected chainId: ${chainId} vs expected: ${chainIdExpected}`);
		}
	});

	// function on(event: string, listener: (event: string, data: any) => void) {
	// 	if (subscriptionHandler) {
	// 		subscriptionHandler.handleOn(event as 'message', listener as any);
	// 	}
	// }

	// function removeListener(event: string, listener: (event: string, data: any) => void) {
	// 	if (subscriptionHandler) {
	// 		subscriptionHandler.handleRemoveListener(event as 'message', listener as any);
	// 	}
	// }

	const provider = {
		request,
		// on,
		// removeListener,
		fallbackOn(provider: EIP1193ProviderWithoutEvents | undefined) {
			_fallbackProvider = provider;
			chainIdPromise = request({ method: 'eth_chainId' }); // re ensure correct chainId
		},
		chainId: chainIdExpected,
		// clearSubscriptions() {
		// 	subscriptionHandler.clearSubscriptions();
		// },
		// stopPolling() {
		// 	poller?.stop();
		// },
	} as unknown as DefaultProvider;
	// const poller = createBlockPoller(provider, 'newHeads', 4000);

	// const subscriptionHandler = createSubscriptionHandler(
	// 	['newHeads'],
	// 	(subcriptionHandler) => {
	// 		poller.start(subcriptionHandler.broadcastNewHeads);
	// 	},
	// 	() => {
	// 		poller.stop();
	// 	}
	// );

	return provider;
}

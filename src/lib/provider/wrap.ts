import type { EIP1193Block, EIP1193Provider, EIP1193Request } from 'eip-1193';
import type {
	EIP1193Observers,
	EIP1193TransactionRequestWithMetadata,
	EIP1193TransactionWithMetadata,
	Metadata,
	SignatureRequestWithMetadata,
	Web3ConnectionProvider,
} from './types';

import { logs } from 'named-logs';
const logger = logs('web3-connection:provider');

export function multiObersvers(oberserversList: EIP1193Observers[]): EIP1193Observers {
	return {
		onTxRequested: (tx: EIP1193TransactionWithMetadata) => {
			for (const observer of oberserversList) {
				if (observer.onTxRequested) {
					observer.onTxRequested(tx);
				}
			}
		},
		onTxCancelled: (tx: EIP1193TransactionWithMetadata) => {
			for (const observer of oberserversList) {
				if (observer.onTxCancelled) {
					observer.onTxCancelled(tx);
				}
			}
		},
		onTxSent: (tx: EIP1193TransactionWithMetadata, hash: string) => {
			for (const observer of oberserversList) {
				if (observer.onTxSent) {
					observer.onTxSent(tx, hash);
				}
			}
		},
		onSignatureRequest: (request: SignatureRequestWithMetadata) => {
			for (const observer of oberserversList) {
				if (observer.onSignatureRequest) {
					observer.onSignatureRequest(request);
				}
			}
		},
		onSignatureCancelled: (request: SignatureRequestWithMetadata) => {
			for (const observer of oberserversList) {
				if (observer.onSignatureCancelled) {
					observer.onSignatureCancelled(request);
				}
			}
		},
		onSignatureResponse: (request: SignatureRequestWithMetadata, signature: string) => {
			for (const observer of oberserversList) {
				if (observer.onSignatureResponse) {
					observer.onSignatureResponse(request, signature);
				}
			}
		},
	};
}

export type WrappProviderConfig = {
	errorOnTimeDifference?:
		| {
				threshold?: number;
				onlyLog?: boolean;
		  }
		| false;

	devProvider?: EIP1193Provider; // TODO use this
};

export function wrapProvider(
	providerToWrap: EIP1193Provider,
	observers: EIP1193Observers,
	config?: WrappProviderConfig,
	emitNewBlockIfNotAlreadyEmitted?: (blockNumber: number) => void
): Web3ConnectionProvider {
	const errorOnTimeDifference =
		config?.errorOnTimeDifference === false
			? false
			: {
					threshold: 3_600_000,
					onlyLog: false,
					...(config?.errorOnTimeDifference || {}),
			  };

	let _syncTime: number | undefined;

	function currentTime() {
		if (!_syncTime) {
			throw new Error(
				`The provider need to be synced with block.timestamp before being able to provide currentTime.`
			);
		}
		return Math.floor((performance.now() + _syncTime) / 1000);
	}

	async function waitNewBlock() {
		const latestBlock = await _request<EIP1193Block>({
			method: 'eth_getBlockByNumber',
			params: ['latest', false],
		});

		let newBlock = await _request<EIP1193Block>({
			method: 'eth_getBlockByNumber',
			params: ['latest', false],
		});

		while (newBlock.number <= latestBlock.number) {
			newBlock = await _request<EIP1193Block>({
				method: 'eth_getBlockByNumber',
				params: ['latest', false],
			});
		}
		return newBlock;
	}

	async function syncTime(latestBlockTime?: number | EIP1193Block) {
		if (!latestBlockTime) {
			const latestBlock = await _request<EIP1193Block>({
				method: 'eth_getBlockByNumber',
				params: ['latest', false],
			});
			const blockTime = parseInt(latestBlock.timestamp.slice(2), 16);
			latestBlockTime = blockTime;
			emitNewBlockIfNotAlreadyEmitted && emitNewBlockIfNotAlreadyEmitted(latestBlockTime);
		} else if (typeof latestBlockTime !== 'number') {
			const blockTime = parseInt(latestBlockTime.timestamp.slice(2), 16);
			latestBlockTime = blockTime;
		}

		const localTimestamp = Date.now();
		const discrepancy = localTimestamp - latestBlockTime * 1000;
		if (errorOnTimeDifference) {
			if (Math.abs(discrepancy) > errorOnTimeDifference.threshold) {
				const hours = Math.floor(discrepancy / 3_600_000);
				const message =
					(discrepancy < 0
						? `Node is ${-hours} hours ahead of your machine's clock.`
						: `Node is ${hours} hours behind of your machine's clock.`) +
					`The client cannot know which one is more correct. Please ensure your node is synced and that your local clock is correct`;
				if (errorOnTimeDifference.onlyLog) {
					console.error(message);
				} else {
					throw new Error(message);
				}
			}
		}

		const performanceNow = performance.now();
		_syncTime = latestBlockTime * 1000 - performanceNow;

		return currentTime();
	}

	let currentObservers: EIP1193Observers | undefined = observers;
	if ((providerToWrap as any).__web3_connection__) {
		const wrappedProvider: Web3ConnectionProvider = providerToWrap as Web3ConnectionProvider;
		// do not rewrap if already an 1193 Proxy, but set the new observers
		wrappedProvider.setObservers(observers);
		return providerToWrap as Web3ConnectionProvider;
	}

	let ethereum = providerToWrap;
	function setUnderlyingProvider(newUnderlyingProvider: EIP1193Provider) {
		ethereum = newUnderlyingProvider;
	}

	let nextMetadata: any | undefined;
	let _subscriptionSupported: boolean = false;
	// let subscriptionHandler: ReturnType<typeof createSubscriptionHandler>;
	// const poller = createBlockPoller(ethereum, 'newHeads', 4000);

	async function handleSignedMessage(
		args: EIP1193Request,
		from: string,
		message: unknown, // TODO type ?
		metadata?: any
	) {
		metadata = getMetadata(metadata);

		let messageWithMetadata = { from, message, metadata, timestamp: await syncTime() };

		if (currentObservers?.onSignatureRequest) {
			currentObservers?.onSignatureRequest(messageWithMetadata);
		}

		try {
			const signature = (await _request(args)) as string;

			if (currentObservers?.onSignatureResponse) {
				currentObservers?.onSignatureResponse(messageWithMetadata, signature);
			}

			return signature;
		} catch (err) {
			if (currentObservers?.onSignatureCancelled) {
				currentObservers?.onSignatureCancelled(messageWithMetadata);
			}
			throw err;
		}
	}

	function getMetadata(metadataArg: Metadata): Metadata {
		let metadata = metadataArg;
		if (!metadata) {
			logger.info(`no metadata in request...`);
			if (nextMetadata) {
				metadata = nextMetadata;
				nextMetadata = undefined;
				if (metadata) {
					logger.info(`metadata found`, metadata);
				} else {
					logger.info(`metadata not found`);
				}
			}
		} else if (nextMetadata) {
			throw new Error(
				`conflicting metadata, metadata was set via "setNextMetadata" but it was also provided as part of the request data`
			);
		}

		return metadata;
	}

	function _request<T>(args: EIP1193Request): Promise<T> {
		if (ethereum.request) {
			return ethereum.request(args) as Promise<T>;
		} else {
			const ethereumSendAsync = ethereum as unknown as {
				sendAsync: (
					request: { method: string; params?: Array<any> },
					callback: (error: any, response: any) => void
				) => void;
				enable?(): Promise<T>;
			};
			const ethereumSend = ethereum as unknown as {
				send: (
					request: { method: string; params?: Array<any> },
					callback: (error: any, response: any) => void
				) => void;
				enable?(): Promise<T>;
			};
			if (ethereumSendAsync.sendAsync) {
				return new Promise<T>((resolve, reject) => {
					if (args.method === 'eth_requestAccounts' && ethereumSendAsync.enable) {
						ethereumSendAsync.enable().then(resolve);
					} else {
						ethereumSendAsync.sendAsync(args, (error: any, response: unknown) => {
							if (error) {
								reject(error);
							} else {
								resolve(
									(response as any).id && (response as any).result
										? (response as any).result
										: response
								);
							}
						});
					}
				});
			} else if (ethereumSend.send) {
				return new Promise<T>((resolve, reject) => {
					if (args.method === 'eth_requestAccounts' && ethereumSendAsync.enable) {
						ethereumSendAsync.enable().then(resolve);
					} else {
						ethereumSend.send(args, (error: any, response: unknown) => {
							if (error) {
								reject(error);
							} else {
								resolve(
									(response as any).id && (response as any).result
										? (response as any).result
										: response
								);
							}
						});
					}
				});
			} else {
				return Promise.reject();
			}

			// const ethereumSendAsync = ethereum as unknown as {
			// 	sendAsync(request: Object, callback: Function): void;
			// };
			// const ethereumSend = ethereum as unknown as {
			// 	send(method: String, params: any[]): Promise<unknown>;
			// };
			// if (ethereumSendAsync.sendAsync) {
			// 	return new Promise<unknown>((resolve, reject) => {
			// 		ethereumSendAsync.sendAsync(args, (response: unknown, error: any) => {
			// 			if (error) {
			// 				reject(error);
			// 			} else {
			// 				resolve(response);
			// 			}
			// 		});
			// 	});
			// } else if (ethereumSend.send) {
			// 	return ethereumSend.send(args.method, (args as any).params || []).then((v) => {
			// 		console.log({ v });
			// 		return v;
			// 	});
			// } else {
			// 	return Promise.reject();
			// }
		}
	}

	async function request(args: EIP1193Request) {
		if (!_syncTime) {
			await syncTime();
		}

		// logger.info(`sending request: ${args.method}`);

		switch (args.method) {
			case 'eth_getBlockByNumber':
				const blockByNumber: EIP1193Block = await _request(args);

				if (args.params[0] === 'latest') {
					if (blockByNumber && blockByNumber.number) {
						emitNewBlockIfNotAlreadyEmitted &&
							emitNewBlockIfNotAlreadyEmitted(parseInt(blockByNumber.number.slice(2), 16));
					}
					syncTime(blockByNumber as EIP1193Block);
				}
				return blockByNumber;
			case 'eth_blockNumber':
				const result: `0x${string}` = await _request(args);
				if (result) {
					emitNewBlockIfNotAlreadyEmitted &&
						emitNewBlockIfNotAlreadyEmitted(parseInt(result.slice(2), 16));
				}
				return result;
			case 'eth_sendTransaction':
				const tx = args.params[0];

				// // TODO if metamask and chainId == 31337/1337
				// if (!tx.nonce) {
				// 	logger.info(`we force fetch pending nonce`);
				// this actually does not work as metamask will still use the cached nonce
				// 	const forcedPendingNonce = await _request({
				// 		method: 'eth_getTransactionCount',
				// 		params: [(`0x` + tx.from.slice(2).toUpperCase()) as `0x${string}`, 'pending'],
				// 	});
				// 	const pendingNonce = forcedPendingNonce;
				// 	// const pendingNonce = await _request({
				// 	// 	method: 'eth_getTransactionCount',
				// 	// 	params: [tx.from, 'pending'],
				// 	// });
				// 	// bug in metamask where it return a number instead of a 0x string
				// 	tx.nonce = (
				// 		typeof pendingNonce === 'string'
				// 			? pendingNonce
				// 			: '0x' + (pendingNonce as number).toString(16)
				// 	) as `0x${string}`;

				// 	logger.info(`tx.nonce = ${tx.nonce}`);
				// }
				const metadata = getMetadata(
					(args as unknown as EIP1193TransactionRequestWithMetadata).params[1]
				);

				let txWithMetadata = { ...tx, metadata, timestamp: await syncTime() };

				if (currentObservers?.onTxRequested) {
					currentObservers?.onTxRequested(txWithMetadata);
				}

				try {
					const hash = await _request({ method: args.method, params: [tx] });

					if (currentObservers?.onTxSent) {
						currentObservers?.onTxSent(txWithMetadata, hash as string);
					}

					return hash;
				} catch (err) {
					if (currentObservers?.onTxCancelled) {
						currentObservers?.onTxCancelled(txWithMetadata);
					}
					throw err;
				}
			case 'eth_sign':
				return handleSignedMessage(
					args,
					args.params[0],
					args.params[1],
					getMetadata((args as any).params[2])
				);
			case 'personal_sign':
				// Note: we reverse the order of param here as personal_sign expect from as 2nd param
				return handleSignedMessage(
					args,
					args.params[1],
					args.params[0],
					getMetadata((args as any).params[2])
				);
			case 'eth_signTypedData':
				return handleSignedMessage(
					args,
					args.params[0],
					args.params[1],
					getMetadata((args as any).params[2])
				);
			case 'eth_signTypedData_v4':
				return handleSignedMessage(
					args,
					args.params[0],
					args.params[1],
					getMetadata((args as any).params[2])
				);
		}

		// TODO handle unlocking via 'eth_requestAccounts ?

		return _request(args);
	}

	// function on(event: string, listener: (event: string, data: any) => void) {
	// 	// if (event === 'message' && subscriptionHandler) {
	// 	// 	subscriptionHandler.handleOn(event as 'message', listener as any);
	// 	// } else {
	// 	return ethereum.on(event as any, listener as any);
	// 	// }
	// }

	// function removeListener(event: string, listener: (event: string, data: any) => void) {
	// 	// if (event === 'message' && subscriptionHandler) {
	// 	// 	subscriptionHandler.handleRemoveListener(event as 'message', listener as any);
	// 	// } else {
	// 	return ethereum.removeListener(event as any, listener as any);
	// 	// }
	// }

	function setNextMetadata(metadata: any) {
		if (nextMetadata) {
			throw new Error(`previous metadata was not consumed. Please resolve the issue.`);
		}
		nextMetadata = metadata;
	}

	function setObservers(observers: EIP1193Observers) {
		currentObservers = observers;
	}

	function unsetObservers() {
		currentObservers = undefined;
	}

	return new Proxy(
		{
			request,
			// on,
			// removeListener,
			setNextMetadata,
			__web3_connection__: true,
			setObservers,
			unsetObservers,
			currentTime,
			syncTime,
			waitNewBlock,
			setUnderlyingProvider,
		},
		{
			get: function (target, property, receiver) {
				switch (property) {
					case 'underlyingProvider':
						return ethereum;
					case 'request':
					// case 'on':
					// case 'removeListener':
					case 'setNextMetadata':
					case '__web3_connection__':
					case 'setObservers':
					case 'currentTime':
					case 'syncTime':
					case 'waitNewBlock':
					case 'unsetObservers':
					case 'setUnderlyingProvider':
					case 'underlyingProvider':
						return (target as any)[property];
				}
				return (ethereum as any)[property];
			},
		}
	) as unknown as Web3ConnectionProvider;
}

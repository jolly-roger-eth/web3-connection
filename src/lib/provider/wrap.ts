import type { EIP1193Provider, EIP1193Transaction, EIP1193Request } from 'eip-1193';
import { createBlockPoller, createSubscriptionHandler } from './subscriptions';

export type EIP1193TransactionRequestWithMetadata = {
	readonly method: 'eth_sendTransaction';
	params: [EIP1193Transaction, any];
};

export type EIP1193TransactionWithMetadata = EIP1193Transaction & {
	metadata?: any;
};

export type SignatureRequest = { from: string; message: unknown; metadata?: any };

export interface EIP1193Observers {
	onTxRequested?: (tx: EIP1193TransactionWithMetadata) => void;
	onTxCancelled?: (tx: EIP1193TransactionWithMetadata) => void;
	onTxSent?: (tx: EIP1193TransactionWithMetadata, hash: string) => void;
	onSignatureRequest?: (request: SignatureRequest) => void;
	onSignatureCancelled?: (request: SignatureRequest) => void;
	onSignatureResponse?: (request: SignatureRequest, signature: string) => void;
}

export type ObservableProvider = EIP1193Provider & {
	setNextMetadata(metadata: any): void;
	__web3_connection_: true;
	setObservers(observers: EIP1193Observers): void;
	unsetObservers(): void;
};

export function wrapProvider(
	ethereum: EIP1193Provider,
	observers: EIP1193Observers
): ObservableProvider {
	let currentObservers: EIP1193Observers | undefined = observers;
	if ((ethereum as any).__web3_connection__) {
		// do not rewrap if already an 1193 Proxy, but set the new observers
		(ethereum as any).setObservers(observers);
		return ethereum as ObservableProvider;
	}

	let nextMetadata: any | undefined;
	let _subscriptionSupported: boolean = false;
	let subscriptionHandler: ReturnType<typeof createSubscriptionHandler>;
	const poller = createBlockPoller(ethereum, 'newHeads', 4000);

	async function handleSignedMessage(
		args: EIP1193Request,
		from: string,
		message: unknown,
		metadata?: any
	) {
		if (!metadata) {
			if (nextMetadata) {
				metadata = nextMetadata;
				nextMetadata = undefined;
			}
		} else if (nextMetadata) {
			throw new Error(
				`conflicting metadata, metadata was set via "setNextMetadata" but it was also provided as part of the request data`
			);
		}

		let messageWithMetadata = { from, message, metadata };

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

	function getMetadata(metadataArg: unknown) {
		let metadata = metadataArg;
		if (!metadata) {
			if (nextMetadata) {
				metadata = nextMetadata;
				nextMetadata = undefined;
			}
		} else if (nextMetadata) {
			throw new Error(
				`conflicting metadata, metadata was set via "setNextMetadata" but it was also provided as part of the request data`
			);
		}
	}

	function _request(args: EIP1193Request): Promise<unknown> {
		if (ethereum.request) {
			return ethereum.request(args);
		} else {
			const ethereumSendAsync = ethereum as unknown as {
				sendAsync: (
					request: { method: string; params?: Array<any> },
					callback: (error: any, response: any) => void
				) => void;
				enable?(): Promise<unknown>;
			};
			const ethereumSend = ethereum as unknown as {
				send: (
					request: { method: string; params?: Array<any> },
					callback: (error: any, response: any) => void
				) => void;
				enable?(): Promise<unknown>;
			};
			if (ethereumSendAsync.sendAsync) {
				return new Promise<unknown>((resolve, reject) => {
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
				return new Promise<unknown>((resolve, reject) => {
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
		switch (args.method) {
			case 'eth_sendTransaction':
				const tx = args.params[0];
				const metadata = getMetadata(
					(args as unknown as EIP1193TransactionRequestWithMetadata).params[1]
				);

				let txWithMetadata = { ...tx, metadata };

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
			case 'eth_subscribe':
				if (subscriptionHandler) {
					return subscriptionHandler.handleSubscriptionRequest(args);
				} else if (_subscriptionSupported) {
					return _request(args);
				} else {
					try {
						// if (args.params[0] == 'newHeads' && (ethereum as any).isBraveWallet) {
						// 	throw new Error('Brave Wallet do not support newHeads subscriptions');
						// }
						const result = await _request(args);
						_subscriptionSupported = true;
						return result;
					} catch (err) {
						console.log(`sucription not supported, falling back on a subscription handler`);
						subscriptionHandler = createSubscriptionHandler(
							['newHeads'],
							(subscriptionHandler) => {
								poller.start(subscriptionHandler.broadcastNewHeads);
							},
							() => {
								poller.stop();
							}
						);
						return subscriptionHandler.handleSubscriptionRequest(args);
					}
				}
			case 'eth_unsubscribe':
				if (subscriptionHandler) {
					return subscriptionHandler.handleUnSubscriptionRequest(args);
				} else {
					return _request(args);
				}
		}

		// TODO handle unlocking via 'eth_requestAccounts ?

		return _request(args);
	}

	function on(event: string, listener: (event: string, data: any) => void) {
		if (event === 'message' && subscriptionHandler) {
			subscriptionHandler.handleOn(event as 'message', listener as any);
		} else {
			return ethereum.on(event as any, listener as any);
		}
	}

	function removeListener(event: string, listener: (event: string, data: any) => void) {
		if (event === 'message' && subscriptionHandler) {
			subscriptionHandler.handleRemoveListener(event as 'message', listener as any);
		} else {
			return ethereum.removeListener(event as any, listener as any);
		}
	}

	function setNextMetadata(metadata: any) {
		if (nextMetadata) {
			throw new Error(`previous metadata was not consumed. Please resolve the issue.`);
		}
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
			on,
			removeListener,
			setNextMetadata,
			__web3_connection__: true,
			setObservers,
			unsetObservers,
		},
		{
			get: function (target, property, receiver) {
				switch (property) {
					case 'request':
					case 'on':
					case 'removeListener':
					case 'setNextMetadata':
					case '__web3_connection__':
					case 'setObservers':
					case 'unsetObservers':
						return (target as any)[property];
				}
				return (ethereum as any)[property];
			},
		}
	) as unknown as ObservableProvider;
}

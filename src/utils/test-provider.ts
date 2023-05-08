import type { EIP1193Account, EIP1193Provider, EIP1193Request, EIP1193Response } from 'eip-1193';

export function initUser() {
	const emitter = new EventTarget();
	let connectedAccounts: { [account: EIP1193Account]: boolean } = {};
	let locked: boolean = false;
	let lastConnectedAccount: EIP1193Account | undefined;
	let listenerMappings: Map<(result: any) => void, (event: CustomEvent) => void> = new Map();
	let promises: { [key: string]: { resolve: (value: any) => void; reject: (error: any) => void } } =
		{};

	function resolve(key: string, value: any) {
		const promise = promises[key];
		if (promise) {
			delete promises[key];
			promise.resolve(value);
		}
	}
	function reject(key: string, value: any) {
		const promise = promises[key];
		if (promise) {
			delete promises[key];
			promise.reject(value);
		}
	}

	const provider: EIP1193Provider = {
		on(eventName: string, callback: (result: any) => void) {
			const eventListener = (event: CustomEvent) => {
				console.log(`${eventName}: ${event.detail}`);
				callback(event.detail as any);
			};
			listenerMappings.set(callback, eventListener);
			emitter.addEventListener(eventName, eventListener as any);
			return this;
		},
		removeListener(eventName: string, callback: (result: any) => void) {
			const eventListener = listenerMappings.get(callback);
			if (eventListener) {
				listenerMappings.delete(callback);
			}
			return this;
		},
		request(request: EIP1193Request): Promise<any> {
			const promise = new Promise((resolve, reject) => {
				switch (request.method) {
					case 'eth_chainId':
						return resolve('0x01');
					case 'eth_getBlockByNumber':
						return resolve({
							number: '0x01',
							hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
							timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
						});
					case 'eth_getBlockByNumber':
						return resolve({
							number: '0x01',
							hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
							timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
						});
					case 'eth_accounts':
						if (lastConnectedAccount && !locked) {
							return resolve([lastConnectedAccount]);
						}
						return resolve([]);
					case 'eth_requestAccounts':
						if (lastConnectedAccount && !locked) {
							return resolve([lastConnectedAccount]);
						}
						const existing = promises['eth_requestAccounts'];
						if (existing) {
							return reject(new Error(`accounts already requested`));
						}
						promises['eth_requestAccounts'] = {
							resolve,
							reject,
						};
						return;
					default:
						throw new Error(`method ${request.method} not supported`);
				}
			});
			return promise;
		},
	};

	const user = {
		installBuiltinProvider() {
			window.ethereum = provider;
			return provider;
		},
		connectAccount(account: EIP1193Account) {
			connectedAccounts[account] = true;
			lastConnectedAccount = account;
			emitter.dispatchEvent(new CustomEvent('accountsChanged', { detail: [account] }));
		},
		lock() {
			const wasLocked = locked;
			locked = true;
			if (!wasLocked && lastConnectedAccount) {
				emitter.dispatchEvent(new CustomEvent('accountsChanged', { detail: [] }));
			}
		},
		unlock() {
			if (lastConnectedAccount) {
				locked = false;
				emitter.dispatchEvent(
					new CustomEvent('accountsChanged', { detail: [lastConnectedAccount] })
				);
			} else {
				throw new Error(`cannot unlock, no account`);
			}
		},
	};

	return user;
}

import type { EIP1193Account, EIP1193Request, EIP1193Response } from 'eip-1193';

export function initTestProvider() {
	const emitter = new EventTarget();
	let accept_next_eth_requestAccounts: EIP1193Account | undefined;
	let connectedAccounts: { [account: EIP1193Account]: boolean } = {};
	let locked: boolean = false;
	let lastConnectedAccount: EIP1193Account | undefined;

	let listenerMappings: Map<(result: any) => void, (event: CustomEvent) => void> = new Map();
	return {
		on(eventName: string, callback: (result: any) => void) {
			const eventListener = (event: CustomEvent) => {
				console.log(`${eventName}: ${event.detail}`);
				callback(event.detail as any);
			};
			listenerMappings.set(callback, eventListener);
			emitter.addEventListener(eventName, eventListener as any);
			return this;
		},
		removeEventListener(eventName: string, callback: (result: any) => void) {
			const eventListener = listenerMappings.get(callback);
			if (eventListener) {
				listenerMappings.delete(callback);
			}
			return this;
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
		acceptNextRequestAccount(account: EIP1193Account) {
			accept_next_eth_requestAccounts = account;
		},
		async request(request: EIP1193Request): Promise<EIP1193Response> {
			switch (request.method) {
				case 'eth_chainId':
					return '0x01';
				case 'eth_getBlockByNumber':
					return {
						number: '0x01',
						hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
						timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
					};
				case 'eth_getBlockByNumber':
					return {
						number: '0x01',
						hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
						timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
					};
				case 'eth_accounts':
					if (lastConnectedAccount && !locked) {
						return [lastConnectedAccount];
					}
					return [];
				case 'eth_requestAccounts':
					if (accept_next_eth_requestAccounts) {
						const account = accept_next_eth_requestAccounts;
						accept_next_eth_requestAccounts = undefined;
						this.connectAccount(account);
						return [account];
					}
					if (lastConnectedAccount && !locked) {
						return [lastConnectedAccount];
					}
					return [];
				default:
					throw new Error(`method ${request.method} not supported`);
			}
		},
	};
}

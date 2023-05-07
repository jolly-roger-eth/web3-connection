import type { EIP1193Account, EIP1193Request, EIP1193Response } from 'eip-1193';

export function initTestProvider() {
	let accept_next_eth_requestAccounts: EIP1193Account | undefined;
	let connectedAccounts: { [account: EIP1193Account]: boolean } = {};
	let lockedAccounts: { [account: EIP1193Account]: boolean } = {};
	let lastConnectedAccount: EIP1193Account | undefined;
	return {
		connectAccount(account: EIP1193Account) {
			connectedAccounts[account] = true;
			lastConnectedAccount = account;
		},
		lockAccount(account: EIP1193Account) {
			lockedAccounts[account] = true;
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
					if (lastConnectedAccount && !lockedAccounts[lastConnectedAccount]) {
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
					return [];
				default:
					throw new Error(`method ${request.method} not supported`);
			}
		},
	};
}

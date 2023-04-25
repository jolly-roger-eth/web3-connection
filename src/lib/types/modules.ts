import type { EIP1193Provider } from 'eip-1193';

export type Web3WModuleLoader = {
	id: string;
	load(): Promise<Web3WModule>;
};

export type Web3WModule = {
	id: string;
	setup(options?: unknown): Promise<
		| { chainId: string; eip1193Provider: EIP1193Provider }
		| { chainId: string; web3Provider: EIP1193Provider } // backward compatibility
	>;
	logout(): Promise<void>;
	disconnect(): void;
};

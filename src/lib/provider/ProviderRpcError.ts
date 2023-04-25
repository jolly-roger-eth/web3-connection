import type { EIP1193ProviderRpcError } from 'eip-1193';

export class ProviderRpcError extends Error implements EIP1193ProviderRpcError {
	constructor(message: string, public readonly code: number, public readonly data?: unknown) {
		super(message);
	}
}

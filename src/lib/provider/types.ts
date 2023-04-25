import type { EIP1193Provider, EIP1193Request } from 'eip-1193';

export type EIP1193BlocknumberSubscribeRequest = {
	method: 'eth_subscribe';
	params: ['newBlocknumber'];
};
export type EIP1193ProviderWithBlocknumberSubscription = EIP1193Provider<
	EIP1193Request | EIP1193BlocknumberSubscribeRequest
>;

import type {
	EIP1193Block,
	EIP1193DATA,
	EIP1193ProviderWithoutEvents,
	EIP1193SubscribeRequest,
	EIP1193SubscriptionMessage,
	EIP1193UnsubscribeRequest,
} from 'eip-1193';
import { ProviderRpcError } from './ProviderRpcError';

type Listener<Message> = (message: Message) => unknown | Promise<unknown>;

export function createSubscriptionHandler(
	types: ('newHeads' | 'newBlocknumber')[],
	onStart: (value: ReturnType<typeof createSubscriptionHandler>) => void,
	onStop: () => void
) {
	const listeners: Listener<EIP1193SubscriptionMessage>[] = [];
	const subscriptions = new Map();
	const idToType = new Map();
	let counter = 0;

	async function handleSubscriptionRequest(args: EIP1193SubscribeRequest): Promise<string> {
		const type = args.params[0];
		const id = '0x' + (++counter).toString(16);

		if (types.indexOf(type as any) === -1) {
			throw new ProviderRpcError(
				`this provider do not support subscription of type "${type}".`,
				4200
			);
		}

		let currentSubscriptionsByType = subscriptions.get(type);
		if (!currentSubscriptionsByType) {
			currentSubscriptionsByType = [];
			subscriptions.set(type, currentSubscriptionsByType);
		}
		currentSubscriptionsByType.push(id);
		idToType.set(id, type);
		startIfActiveSubscription();
		return id;
	}
	async function handleUnSubscriptionRequest(args: EIP1193UnsubscribeRequest): Promise<boolean> {
		const id = args.params[0];
		const type = idToType.get(id);
		if (!type) {
			throw new ProviderRpcError(
				`subcription ${id} do not exists or has already been unsubscribed`,
				4000
			); // TODO code ?
		}
		const currentSubscriptionsByType = subscriptions.get(type);

		const index = currentSubscriptionsByType.indexOf(id);
		if (index > -1) {
			currentSubscriptionsByType.splice(index, 1);
		}
		idToType.delete(id);

		stopIfNoActiveSubscription();
		return true;
	}
	function handleOn(event: 'message', listener: Listener<EIP1193SubscriptionMessage>) {
		if (event !== 'message') {
			throw new ProviderRpcError(
				`this provider do not support subscription of event of type "${event}". It currently only support the "message" type after subscription via "eth_subscribe"`,
				4200
			);
		}
		const index = listeners.indexOf(listener);
		if (index === -1) {
			listeners.push(listener);
		}

		startIfActiveSubscription();
	}

	function handleRemoveListener(event: 'message', listener: Listener<EIP1193SubscriptionMessage>) {
		if (event !== 'message') {
			throw new ProviderRpcError(
				`this provider do not support subscription of event of type "${event}". It currently only support the "message" type after subscription via "eth_subscribe"`,
				4200
			);
		}
		const index = listeners.indexOf(listener);
		if (index > -1) {
			listeners.splice(index, 1);
		}
		stopIfNoActiveSubscription();
	}

	function broadcast(type: string, data: unknown) {
		const subscriptionsToFullfill = subscriptions.get(type) || [];
		for (const subscription of subscriptionsToFullfill) {
			for (const listener of listeners) {
				listener({
					type: 'eth_subscription',
					data: {
						result: data,
						subscription,
					},
				});
			}
		}
	}

	function clearSubscriptions() {
		listeners.splice(0, listeners.length);
		subscriptions.clear();
		idToType.clear();
		onStop();
	}

	const handler = {
		handleSubscriptionRequest,
		handleOn,
		broadcastNewHeads: broadcast as (type: 'newHeads', data: EIP1193Block) => void,
		broadcastNewBlocknumber: broadcast as (type: 'newBlocknumber', data: EIP1193DATA) => void,
		handleUnSubscriptionRequest,
		handleRemoveListener,
		clearSubscriptions,
	};

	let active = false;
	function startIfActiveSubscription() {
		try {
			if (!active && listeners.length > 0 && subscriptions.size > 0) {
				active = true;
				onStart(handler);
			}
		} catch {}
	}

	function stopIfNoActiveSubscription() {
		try {
			if ((active && listeners.length === 0) || subscriptions.size === 0) {
				active = false;
				onStop();
			}
		} catch {}
	}

	return handler;
}

export type Poller<
	T extends (type: any, data: any) => void =
		| ((type: 'newHeads', data: EIP1193Block) => void)
		| ((type: 'newBlocknumber', data: EIP1193DATA) => void)
> = {
	start: (broadcast: T) => void;
	stop: () => void;
};

export function createBlockPoller(
	provider: EIP1193ProviderWithoutEvents,
	type: 'newHeads',
	intervalInMs: number
): Poller<(type: 'newHeads', data: EIP1193Block) => void>;
export function createBlockPoller(
	provider: EIP1193ProviderWithoutEvents,
	type: 'newBlocknumber',
	intervalInMs: number
): Poller<(type: 'newBlocknumber', data: EIP1193DATA) => void>;
export function createBlockPoller(
	provider: EIP1193ProviderWithoutEvents,
	type: 'newBlocknumber' | 'newHeads',
	intervalInMs: number
): Poller {
	let _broadcast: any | undefined;

	async function sync() {
		const blockNumberAsHex = await provider.request({ method: 'eth_blockNumber' });
		const blockNumber = parseInt(blockNumberAsHex.slice(2), 16);

		try {
			const numBlockToFetch = blockNumber - lastBlockNumber;
			if (type === 'newHeads') {
				for (let i = 0; i < numBlockToFetch; i++) {
					const blockNumberToFetch = lastBlockNumber + i;
					const block = await provider.request({
						method: 'eth_getBlockByNumber',
						params: [`0x${blockNumberToFetch.toString(16)}`, false],
					});
					try {
						if (_broadcast) {
							(_broadcast as any)(type, block);
						}
					} finally {
						lastBlockNumber = blockNumberToFetch;
					}
				}
			} else if (numBlockToFetch > 0) {
				try {
					if (_broadcast) {
						(_broadcast as any)(type, blockNumberAsHex);
					}
				} finally {
					lastBlockNumber = blockNumber;
				}
			}
		} finally {
			syncNextTime();
		}
	}

	let nextSync: number | undefined;
	function syncNextTime() {
		nextSync = setTimeout(sync, intervalInMs);
	}

	let _starting: Promise<void> | undefined;
	let _stopped: boolean;
	let lastBlockNumber: number;
	async function promiseToStart() {
		try {
			const blockNumberAsHex = await provider.request({ method: 'eth_blockNumber' });
			lastBlockNumber = parseInt(blockNumberAsHex.slice(2), 16);
			if (!_stopped) {
				syncNextTime();
			}
		} finally {
			_starting = undefined;
		}
	}
	function start(broadcast: any) {
		_broadcast = broadcast;
		_stopped = false;
		if (!_starting) {
			_starting = promiseToStart();
		}
		return _starting;
	}

	function stop() {
		_stopped = true;
		if (nextSync) {
			clearTimeout(nextSync);
			nextSync = undefined;
		}
	}

	return {
		start,
		stop,
	};
}

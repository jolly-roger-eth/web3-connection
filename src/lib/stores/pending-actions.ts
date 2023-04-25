import type { EIP1193Observers } from '$lib/provider/wrap';
import { createStore } from '$lib/utils/stores';

export type PendingActionsState = {
	list: any[];
};

function remove<T>(arr: T[], func: (v: T) => void) {
	const index = arr.findIndex(func);
	if (index > -1) {
		arr.splice(index, 1);
	}
}

function removeItem<T>(arr: { item: T }[], i: T) {
	const index = arr.findIndex((v) => v.item === i);
	if (index > -1) {
		arr.splice(index, 1);
	}
}

export function createPendingActionsStore() {
	const { $state, set, readable } = createStore<PendingActionsState>({
		list: [],
	});

	const observers: EIP1193Observers = {
		onTxRequested(tx) {
			$state.list.push({ type: 'transaction', item: tx });
			set({ list: $state.list });
		},
		onTxCancelled(tx) {
			removeItem($state.list, tx);
			set({ list: $state.list });
		},
		onTxSent(tx, hash) {
			removeItem($state.list, tx);
			set({ list: $state.list });
		},
		onSignatureRequest(request) {
			$state.list.push({ type: 'signature', item: request });
			set({ list: $state.list });
		},
		onSignatureCancelled(request) {
			removeItem($state.list, request);
			set({ list: $state.list });
		},
		onSignatureResponse(request, signature) {
			removeItem($state.list, request);
			set({ list: $state.list });
		},
	};

	function skip() {
		$state.list.shift();
		set({ list: $state.list });
	}

	const store = {
		...readable,
		skip,
	};
	return { pendingActions: store, observers };
}

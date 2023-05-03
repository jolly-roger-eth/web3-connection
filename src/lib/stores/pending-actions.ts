/**
 * This is pending user action
 * This is only used in memory
 * It receive all request going through the wallet provider and let the UI know that some tx/signatures are being requested
 * Once a tx/sig is accepted or rejected it get removed from here
 * On a page reload, the txs are not there anymore
 * This is because the execution context is lost by then
 * we could potentially offer to save these pending action and have a UI acknowledging their execution context loss
 *  and warn the user that it should cancel them
 *  Ideally wallets should provide an EIP that let use cancel these
 */
import type {
	EIP1193Observers,
	EIP1193TransactionWithMetadata,
	SignatureRequestWithMetadata,
} from '$lib/provider/wrap';
import { createStore } from '$lib/utils/stores';

export type PendingAction =
	| { type: 'transaction'; item: EIP1193TransactionWithMetadata }
	| { type: 'signature'; item: SignatureRequestWithMetadata };

export type PendingActionsState = {
	list: PendingAction[];
};

function removeItem(
	arr: PendingAction[],
	i: SignatureRequestWithMetadata | EIP1193TransactionWithMetadata
) {
	const index = arr.findIndex((v) => v.item === i);
	if (index > -1) {
		arr.splice(index, 1);
	}
}

function addTx(arr: PendingAction[], i: EIP1193TransactionWithMetadata) {
	arr.push({ type: 'transaction', item: i });
}

function addSig(arr: PendingAction[], i: SignatureRequestWithMetadata) {
	arr.push({ type: 'signature', item: i });
}

export function createPendingActionsStore() {
	const { $state, set, readable } = createStore<PendingActionsState>({
		list: [],
	});

	const observers: EIP1193Observers = {
		onTxRequested(tx) {
			addTx($state.list, tx);
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
			addSig($state.list, request);
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

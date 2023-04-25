// const LOCAL_STORAGE_TRANSACTIONS_SLOT = '_web3w_transactions';
const LOCAL_STORAGE_PREVIOUS_WALLET_SLOT = '_web3w_previous_wallet_type';
export function recordSelection(type: string) {
	try {
		localStorage.setItem(LOCAL_STORAGE_PREVIOUS_WALLET_SLOT, type);
	} catch (e) {}
}

export function fetchPreviousSelection() {
	try {
		return localStorage.getItem(LOCAL_STORAGE_PREVIOUS_WALLET_SLOT);
	} catch (e) {
		return null;
	}
}

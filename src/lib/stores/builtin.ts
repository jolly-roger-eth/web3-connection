import type { EIP1193Provider } from 'eip-1193';
import { createStore } from '$lib/utils/stores';
import { fetchEthereum, getVendor } from '$lib/utils/windowEthereum';

export type BuiltinState = {
	state: 'Idle' | 'Ready';
	probing: boolean;
	error?: string;
	available?: boolean;
	vendor?: string;
};

// const perWindow: WeakMap<Window, any> = new WeakMap();
export function createBuiltinStore(window?: Window) {
	// if (window && perWindow.has(window)) {
	// 	return perWindow.get(window);
	// }
	let probingPromise: Promise<EIP1193Provider | undefined> | undefined;
	let provider: EIP1193Provider | undefined;

	const { set, readable } = createStore<BuiltinState>({
		state: 'Idle',
		probing: false,
	});

	function probe(): Promise<EIP1193Provider | undefined> {
		if (probingPromise) {
			return probingPromise;
		}

		probingPromise = new Promise(async (resolve, reject) => {
			if (provider) {
				return resolve(provider);
			}
			if (!window) {
				set({ probing: false, state: 'Ready', available: false, vendor: undefined });
				return resolve(undefined);
			}

			set({ probing: true });
			try {
				const ethereum = await fetchEthereum(window);
				if (ethereum) {
					// used to be necessary for Metamask
					(ethereum as any).autoRefreshOnNetworkChange = false;

					provider = ethereum;
					set({ probing: false, state: 'Ready', available: true, vendor: getVendor(ethereum) });
				} else {
					set({ probing: false, state: 'Ready', available: false, vendor: undefined });
				}
				resolve(ethereum);
			} catch (err) {
				set({ probing: false, error: (err as any).message || err });
				return reject(err);
			}
		});
		return probingPromise;
	}

	const store = {
		...readable,
		probe,
	};
	// if (window) {
	// 	perWindow.set(window, store);
	// }
	return store;
}

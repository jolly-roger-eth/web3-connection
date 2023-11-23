import type { EIP1193Provider } from 'eip-1193';
import { createStore } from '$lib/utils/stores';
import { fetchEthereum, getVendor } from '$lib/utils/windowEthereum';

type EIP6963ProviderInfo = {
	uuid: string;
	name: string;
	icon: string;
	rdns: string;
};

type EIP6963ProviderDetail = {
	info?: EIP6963ProviderInfo;
	provider: EIP1193Provider;
};

interface EIP6963AnnounceProviderEvent extends CustomEvent {
	type: 'eip6963:announceProvider';
	detail: EIP6963ProviderDetail;
}

export type BuiltinState = {
	state: 'Idle' | 'Ready';
	probing: boolean;
	error?: string;
	available?: boolean;
	vendor?: string;
	walletsAnnounced: EIP6963ProviderDetail[];
	ethereumAnnounced: boolean;
};

// const perWindow: WeakMap<Window, any> = new WeakMap();
export function createBuiltinStore(window?: Window) {
	// if (window && perWindow.has(window)) {
	// 	return perWindow.get(window);
	// }
	let probingPromise: Promise<EIP1193Provider | undefined> | undefined;
	let provider: EIP1193Provider | undefined;
	let walletsAnnounced: EIP6963ProviderDetail[] = [];

	const { set, readable } = createStore<BuiltinState>({
		state: 'Idle',
		probing: false,
		walletsAnnounced,
		ethereumAnnounced: false,
	});

	if (window) {
		// we prove announcing provider as soon as we can
		(window as any).addEventListener(
			'eip6963:announceProvider',
			(event: EIP6963AnnounceProviderEvent) => {
				const existing = walletsAnnounced.find(
					(v) => v.info?.uuid === event.detail.info?.uuid || v.provider === event.detail.provider
				);
				if (existing && !existing.info) {
					existing.info = event.detail.info;
					set({ walletsAnnounced });
				} else {
					walletsAnnounced.push(event.detail);
					set({ walletsAnnounced });
				}
			}
		);
		window.dispatchEvent(new Event('eip6963:requestProvider'));
	}

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
					const announced = !!walletsAnnounced.find((v) => v.provider === ethereum);
					// used to be necessary for Metamask
					(ethereum as any).autoRefreshOnNetworkChange = false;

					provider = ethereum;
					set({
						probing: false,
						state: 'Ready',
						available: true,
						vendor: getVendor(ethereum),
						ethereumAnnounced: announced,
					});
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

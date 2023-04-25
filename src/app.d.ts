import { EIP1193Provider } from '$lib/types';

// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface Platform {}
	}

	interface Window {
		ethereum?: EIP1193Provider;
	}
	interface WindowWithEthereum extends Window {
		ethereum: EIP1193Provider;
	}
}

export {};

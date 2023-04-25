import type { EIP1193Provider } from 'eip-1193';

export function getEthereum(window: Window): EIP1193Provider | undefined {
	if (typeof window !== 'undefined') {
		return window.ethereum;
	}
	return undefined;
}

export function fetchEthereum(window: Window): Promise<EIP1193Provider | undefined> {
	const document = window.document;
	// TODO test with document.readyState !== 'complete' || document.readyState === 'interactive'
	return new Promise((resolve) => {
		const ethereum = getEthereum(window);
		if (ethereum) {
			return resolve(ethereum);
		}
		if (document.readyState !== 'complete') {
			document.onreadystatechange = function () {
				if (document.readyState === 'complete') {
					document.onreadystatechange = null;
					resolve(getEthereum(window));
				}
			};
		} else {
			resolve(getEthereum(window));
		}
	});
}

export function getVendor(ethereum: any): string | undefined {
	if (!ethereum) {
		return undefined;
	} else if (ethereum.isBraveWallet) {
		return 'Brave'; // need to be checked before Metamask as Brave also have `isMetamask`
	} else if (ethereum.isMetaMask) {
		return 'Metamask';
	} else if (ethereum.isFrame) {
		return 'Frame';
	} else if (
		(navigator as any).userAgent.indexOf('Opera') != -1 ||
		(navigator as any).userAgent.indexOf('OPR/') != -1
	) {
		return 'Opera';
	} else {
		return 'unknown';
	}
	// TODO more
}

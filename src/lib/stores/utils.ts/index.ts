import type { EIP1193ProviderWithoutEvents, EIP1193Request } from 'eip-1193';

export type Timeout = NodeJS.Timeout;

export function timeoutRequest<T>(
	provider: EIP1193ProviderWithoutEvents,
	request: EIP1193Request,
	delay = 2
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let timedOut = false;
		const timeout = setTimeout(async () => {
			timedOut = true;
			reject(`request timed out after ${delay} seconds`);
		}, delay * 1000);
		const requestPromise = provider.request(request);
		requestPromise
			.then((response) => {
				if (!timedOut) {
					clearTimeout(timeout);
					resolve(response as T);
				}
			})
			.catch((err) => {
				if (!timedOut) {
					reject(err);
				}
			});
	});
}

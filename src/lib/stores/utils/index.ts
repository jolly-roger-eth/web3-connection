import type { EIP1193ProviderWithoutEvents, EIP1193Request } from 'eip-1193';
import { logs } from 'named-logs';

const logger = logs('web3-connection-timeout');

export type Timeout = NodeJS.Timeout;

export function timeoutRequest<T>(
	provider: EIP1193ProviderWithoutEvents,
	request: EIP1193Request,
	delay = 2
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let timeout: Timeout | undefined = setTimeout(() => {
			logger.error(`request timed out after ${delay} second`, { provider, request });
			timeout = undefined;
			reject(`request timed out after ${delay} seconds`);
		}, delay * 1000);
		const requestPromise = provider.request(request);
		requestPromise
			.then((response) => {
				if (timeout) {
					clearTimeout(timeout);
					timeout = undefined;
					resolve(response as T);
				} else {
					logger.error(`request succeded after timeout passed`, response);
				}
			})
			.catch((err) => {
				if (timeout) {
					clearTimeout(timeout);
					timeout = undefined;
					reject(err);
				} else {
					logger.error(`request failed after timeout passed`, err);
				}
			});
	});
}

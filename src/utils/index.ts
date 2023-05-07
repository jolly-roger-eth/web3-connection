import type { Readable } from 'svelte/store';

export function waitFor<T>(connection: Readable<T>, object: Partial<T>) {
	return new Promise<any>((resolve) => {
		connection.subscribe(($connection) => {
			for (const key of Object.keys(object)) {
				const current = ($connection as any)[key];
				const value = (object as any)[key];
				if (typeof value !== 'undefined') {
					if (current === value) {
						return resolve(current);
					}
				} else {
					if (current) {
						return resolve(current);
					}
				}
			}
		});
	});
}

export function wait(numSeconds: number) {
	return new Promise((resolve) => setTimeout(resolve, numSeconds * 1000));
}

type ResolveFunction<T> = (value: T) => unknown;
type RejectFunction = (err: unknown) => void;

export function createManageablePromise<T>(callbacks?: {
	onResolve: ResolveFunction<T>;
	onReject: RejectFunction;
}) {
	let _promise: Promise<T> | undefined;
	let _resolve: ResolveFunction<T> | undefined;
	let _reject: RejectFunction | undefined;
	function clear(): { reject: RejectFunction; resolve: ResolveFunction<T> } | undefined {
		if (_promise) {
			const past = { reject: _reject as RejectFunction, resolve: _resolve as ResolveFunction<T> };
			_promise = undefined;
			_resolve = undefined;
			_reject = undefined;
			return past;
		}
		return undefined;
	}
	return {
		promise(execute?: (resolve: ResolveFunction<T>, reject: RejectFunction) => void) {
			if (_promise) {
				return _promise;
			}
			_promise = new Promise((resolve, reject) => {
				_resolve = resolve;
				_reject = reject;
				if (execute) {
					execute(_resolve, _reject);
				}
			});
			return _promise;
		},
		reject(err: unknown) {
			if (_reject) {
				clear()?.reject(err);
				callbacks?.onReject(err);
			}
			// TODO remove, not really errors
			// console.error(`no pending promise, cannot reject`);
		},
		resolve(value: T) {
			if (_resolve) {
				clear()?.resolve(value);
				callbacks?.onResolve(value);
			}
			// TODO remove, not really errors
			// console.error(`no pending promise, cannot resolve`);
		},
	};
}

type PromiseBundle<T> = {
	promise: Promise<T>;
	resolve: ResolveFunction<T>;
	reject: RejectFunction;
};

export function createManageablePromiseWithId<T>(callbacks?: {
	onResolve: ResolveFunction<T>;
	onReject: RejectFunction;
}) {
	let _mapping: {
		[id: string]: PromiseBundle<T>;
	} = {};
	function clear(id?: string): { reject: RejectFunction; resolve: ResolveFunction<T> } | undefined {
		if (id) {
			if (_mapping[id]) {
				const past = {
					reject: _mapping[id].reject as RejectFunction,
					resolve: _mapping[id].resolve as ResolveFunction<T>,
				};
				delete _mapping[id];
				return past;
			}
		} else {
			const allIds = Object.keys(_mapping);
			for (const id of allIds) {
				clear(id);
			}
		}

		return undefined;
	}
	return {
		promise(id: string, execute?: (resolve: ResolveFunction<T>, reject: RejectFunction) => void) {
			if (_mapping[id]) {
				return _mapping[id].promise;
			}
			_mapping[id] = {} as PromiseBundle<T>;
			_mapping[id].promise = new Promise<T>((resolve, reject) => {
				_mapping[id].resolve = resolve;
				_mapping[id].reject = reject;

				if (execute) {
					execute(_mapping[id].resolve, _mapping[id].reject);
				}
			});

			return _mapping[id].promise;
		},
		reject(ids: string | string[], err: unknown) {
			if (ids === '' || ids === '*') {
				const allIds = Object.keys(_mapping);
				for (const id of allIds) {
					clear(id)?.reject(err);
				}
			} else {
				if (typeof ids === 'string') {
					if (_mapping[ids]) {
						clear(ids)?.reject(err);
						callbacks?.onReject(err);
					}
				} else {
					for (const id of ids) {
						if (_mapping[id]) {
							clear(id)?.reject(err);
							callbacks?.onReject(err);
						}
					}
				}
			}
		},
		resolve(ids: string | string[], value: T) {
			if (ids === '' || ids === '*') {
				const allIds = Object.keys(_mapping);
				for (const id of allIds) {
					clear(id)?.resolve(value);
				}
			} else {
				if (typeof ids === 'string') {
					if (_mapping[ids]) {
						clear(ids)?.resolve(value);
						callbacks?.onResolve(value);
					}
				} else {
					for (const id of ids) {
						if (_mapping[id]) {
							clear(id)?.resolve(value);
							callbacks?.onResolve(value);
						}
					}
				}
			}
		},
	};
}

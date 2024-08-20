import type { Readable } from 'svelte/store';
export declare function waitFor<T>(connection: Readable<T>, object: Partial<T>): Promise<any>;
export declare function wait(numSeconds: number): Promise<unknown>;

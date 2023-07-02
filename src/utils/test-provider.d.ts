import type { EIP1193Account, EIP1193Provider, EIP1193ProviderWithoutEvents } from 'eip-1193';
export declare function initUser(): {
    installBuiltinProvider(): EIP1193Provider;
    connectAccount(account: EIP1193Account): void;
    switchChain(chainId: string): void;
    lock(): void;
    unlock(): void;
};
export declare function fakeRPCProvider(chainId: string): EIP1193ProviderWithoutEvents;

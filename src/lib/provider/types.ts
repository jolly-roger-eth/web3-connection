import type {
	EIP1193Block,
	EIP1193Provider,
	EIP1193Request,
	EIP1193TransactionData,
} from 'eip-1193';

export type EIP1193BlocknumberSubscribeRequest = {
	method: 'eth_subscribe';
	params: ['newBlocknumber'];
};
export type EIP1193ProviderWithBlocknumberSubscription = EIP1193Provider<
	EIP1193Request | EIP1193BlocknumberSubscribeRequest
>;

export type EIP1193TransactionRequestWithMetadata = {
	readonly method: 'eth_sendTransaction';
	params: [EIP1193TransactionData, any];
};

export type Metadata = unknown; // TODO have some mandatory field like id ? or maybe at least be an object ?

export type EIP1193TransactionWithMetadata = EIP1193TransactionData & {
	timestamp: number;
	metadata?: Metadata;
};

export type SignatureRequestWithMetadata = {
	from: string;
	message: unknown;
	timestamp: number;
	metadata?: Metadata;
};

export interface EIP1193Observers {
	onTxRequested?: (tx: EIP1193TransactionWithMetadata) => void;
	onTxCancelled?: (tx: EIP1193TransactionWithMetadata) => void;
	onTxSent?: (tx: EIP1193TransactionWithMetadata, hash: string) => void;
	onSignatureRequest?: (request: SignatureRequestWithMetadata) => void;
	onSignatureCancelled?: (request: SignatureRequestWithMetadata) => void;
	onSignatureResponse?: (request: SignatureRequestWithMetadata, signature: string) => void;
}

export type ObservableProvider = EIP1193ProviderWithBlocknumberSubscription & {
	setObservers(observers: EIP1193Observers): void;
	unsetObservers(): void;
};

export type Web3ConnectionProvider = ObservableProvider & {
	setNextMetadata(metadata: any): void;
	__web3_connection_: true;
	currentTime(): number;
	syncTime(latestBlockTime?: number | EIP1193Block): Promise<number>;
	waitNewBlock(): Promise<EIP1193Block>;
	underlyingProvider: EIP1193ProviderWithBlocknumberSubscription;
	setUnderlyingProvider(ethereum: EIP1193ProviderWithBlocknumberSubscription): void;
};

import type { EIP1193Observers, Web3ConnectionProvider } from '$lib/provider/types';
import type { WrappProviderConfig } from '$lib/provider/wrap';
import type { Web3WModule, Web3WModuleLoader } from '$lib/types/modules';
import type { NonceCachedStatus } from '$lib/utils/chain';
import type { Abi, Address } from 'abitype';
import type { EIP1193GenericRequestProvider } from 'eip-1193';

export type ConnectionRequirements =
	| 'connection' // only connected to perform raw read-only calls, any network
	| 'connection+network' // connected to perform contract read-only call to supported network
	| 'connection+account' // connected to perform raw call, including write one, any network
	| 'connection+network+account'; // connected to perform contract read and write call to supported network

export type GenericContractsInfos = {
	readonly [name: string]: { readonly address: `0x${string}`; readonly abi: Abi };
};

export type SingleNetworkConfig<ContractsInfos extends GenericContractsInfos> = {
	chainId: string;
	name?: string;
	contracts: ContractsInfos;
};

// // TODO rethink this : or support array too ?
// Also note that we expect all contract to have same abi to ensure we cna use typesafety
export type MultiNetworkConfigs<ContractsInfos extends GenericContractsInfos> = {
	chains: { [chainId: string]: SingleNetworkConfig<ContractsInfos> };
};

export type NetworkConfigs<ContractsInfos extends GenericContractsInfos> =
	| SingleNetworkConfig<ContractsInfos>
	| ((
			chainId: string,
	  ) => Promise<SingleNetworkConfig<ContractsInfos> | MultiNetworkConfigs<ContractsInfos>>);

export type Web3ConnectionError = {
	title?: string;
	message: string;
	id?: string;
	cause?: any;
};

type BaseConnectionState = {
	// executionRequireUserConfirmation?: boolean;
	error?: Web3ConnectionError;
	toJSON?(): Partial<ConnectionState>;
};

export type ConnectedState = BaseConnectionState & {
	state: 'Connected';
	requirements: ConnectionRequirements;
	initialised: true;
	connecting: false;
	requireSelection: false;
	loadingModule: false;
	walletType: { type: string; name?: string };
	provider: Web3ConnectionProvider;
	httpProvider?: EIP1193GenericRequestProvider;
};

export type DisconnectedState = BaseConnectionState & {
	state: 'Disconnected';
	requirements?: ConnectionRequirements;
	initialised: boolean; // COuld be an Idle state instead ?
	connecting: boolean;
	requireSelection: boolean;
	loadingModule: boolean;
	walletType?: { type: string; name?: string };
	provider?: Web3ConnectionProvider;
	httpProvider?: EIP1193GenericRequestProvider;
};

export type ConnectionState = ConnectedState | DisconnectedState;

export type NetworkState<ContractsInfos extends GenericContractsInfos> =
	| DisconectedNetworkState
	| DisconectedBecauseNotSupportedNetworkState
	| ConnectedNetworkState<ContractsInfos>;

type BaseNetworkState = {
	error?: Web3ConnectionError;

	genesisHash?: string;
	genesisNotMatching?: boolean;
	nonceCached?: NonceCachedStatus;
	blocksCached?: boolean;
	hasEncounteredBlocksCacheIssue?: boolean;
};

export type DisconectedNetworkState = BaseNetworkState & {
	state: 'Disconnected';
	fetchingChainId: boolean;
	chainId?: string;
	loading: boolean;
	notSupported: undefined;
	contracts: undefined;
};

export type DisconectedBecauseNotSupportedNetworkState = BaseNetworkState & {
	state: 'Disconnected';
	fetchingChainId: false;
	chainId: string;
	loading: false;
	notSupported: true;
	contracts: undefined;
};

export type ConnectedNetworkState<ContractsInfo extends GenericContractsInfos> =
	BaseNetworkState & {
		state: 'Connected';
		fetchingChainId: false;
		chainId: string;
		loading: false;
		notSupported: false;
		contracts: GenericContractsInfos;
	};

type BaseAccountState = {
	error?: Web3ConnectionError;
};

export type AccountState<TAddress extends Address> =
	| ConnectedAccountState<TAddress>
	| DisconnectedAccountState<TAddress>;

export type ConnectedAccountState<TAddress extends Address> = BaseAccountState & {
	state: 'Connected';
	locked: false;
	unlocking: false;
	fetching: false;
	address: TAddress;
	isLoadingData: undefined;
	loadingStep: undefined;
};

export type DisconnectedAccountState<TAddress extends Address> = BaseAccountState & {
	state: 'Disconnected';
	locked: boolean;
	unlocking: boolean;
	fetching: boolean;
	address?: TAddress;
	isLoadingData?: string;
	loadingStep?: { id: string; data?: any };
};

export type OnConnectionExecuteState = {
	connection: ConnectedState;
};
export type ConnectAndExecuteCallback<T> = (state: OnConnectionExecuteState) => Promise<T>;

export type OnExecuteState<
	ContractsInfos extends GenericContractsInfos,
	TAddress extends Address,
> = {
	connection: ConnectedState;
	account: ConnectedAccountState<TAddress>;
	network: ConnectedNetworkState<ContractsInfos>;
};
export type ExecuteCallback<
	ContractsInfos extends GenericContractsInfos,
	TAddress extends Address,
	T,
> = (state: OnExecuteState<ContractsInfos, TAddress>) => Promise<T>;

export type ExecutionState = {
	executing: boolean;
	requireUserConfirmation?: boolean;
	error?: Web3ConnectionError;
};

export type Parameters = {
	finality: number;
	blockTime: number;
	timeout: number;
};

export type ParametersPerNetwork = { default: Parameters; [chainId: string]: Parameters };
export type FlexibleParameters = Parameters | ParametersPerNetwork;

export type ConnectionConfig<
	NetworkConfig extends NetworkConfigs<ContractsInfos>,
	ContractsInfos extends GenericContractsInfos,
> = {
	options?: (string | Web3WModule | Web3WModuleLoader)[];
	parameters?: FlexibleParameters;
	autoConnectUsingPrevious?: boolean;
	networks?: NetworkConfig;
	provider?: WrappProviderConfig;
	defaultRPC?: { chainId: string; url: string }; // TODO per chain ?
	acccountData?: {
		loadWithNetworkConnected: (
			state: {
				address: `0x${string}`;
				connection: ConnectedState;
				network: DisconectedBecauseNotSupportedNetworkState | ConnectedNetworkState<ContractsInfos>;
			},
			setLoadingMessage: (msg: string) => void,
			waitForStep: (id?: string, data?: any) => Promise<unknown>,
		) => Promise<void>;
		unload: () => Promise<void>;
	};
	observers?: EIP1193Observers;
	devNetwork?: {
		chainId: string;
		url: string;
		checkCacheIssues?: boolean;
	};
};

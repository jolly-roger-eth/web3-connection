import type { Web3WModule, Web3WModuleLoader } from '$lib/types/modules';
import { createStore } from '$lib/utils/stores';
import { createBuiltinStore } from './builtin';
import { logs } from 'named-logs';
import { wait } from '$lib/utils/time';
import { formatChainId } from '$lib/utils/ethereum';
import { multiObersvers, wrapProvider, type EIP1193Observers } from '$lib/provider/wrap';
import { createPendingActionsStore } from './pending-actions';
import { createManageablePromise, createManageablePromiseWithId } from '$lib/utils/promises';
import { getContractInfos } from '$lib/utils/contracts';
import { fetchPreviousSelection, recordSelection } from './localStorage';
import type { EIP1193ChainId, EIP1193Provider, EIP1193ProviderRpcError } from 'eip-1193';
import type { DefaultProvider } from '$lib/provider/rpc';
import { createRPCProvider } from '$lib/provider/rpc';

const logger = logs('web3-connection');

export type ConnectionRequirements =
	| 'connection' // only connected to perform raw read-only calls, any network
	| 'connection+network' // connected to perform contract read-only call to supported network
	| 'connection+account' // connected to perform raw call, including write one, any network
	| 'connection+network+account'; // connected to perform contract read and write call to supported network

// TODO ABI type (use abitype ?)
type GenericAbi = readonly any[];
export type GenericContractsInfos = {
	readonly [name: string]: { readonly address: `0x${string}`; readonly abi: GenericAbi };
};

export type GenericNetworkConfig = {
	chainId: string;
	name?: string;
	contracts: GenericContractsInfos;
};

// TODO rethink this : or support array too ?
export type MultiNetworkConfigs<N extends GenericNetworkConfig> = {
	chains: { [chainId: string]: N };
};

export type NetworkConfigs<N extends GenericNetworkConfig> =
	| MultiNetworkConfigs<N>
	| N
	| ((chainId: string) => Promise<N | MultiNetworkConfigs<N>>);

export type ConnectionError = { title?: string; message: string; code: number };

type BaseConnectionState = {
	// executionRequireUserConfirmation?: boolean;
	error?: ConnectionError;
	toJSON?(): Partial<ConnectionState>;
};

export type ConnectedState = BaseConnectionState & {
	state: 'Connected';
	initialised: true;
	connecting: false;
	requireSelection: false;
	loadingModule: false;
	walletType: { type: string; name?: string };
	provider: EIP1193Provider;
	defaultProvider?: DefaultProvider;
};

export type DisconnectedState = BaseConnectionState & {
	state: 'Disconnected';
	initialised: boolean; // COuld be an Idle state instead ?
	connecting: boolean;
	requireSelection: boolean;
	loadingModule: boolean;
	walletType?: { type: string; name?: string };
	provider?: EIP1193Provider;
	defaultProvider?: DefaultProvider;
};

export type ConnectionState = ConnectedState | DisconnectedState;

export type NetworkState<NetworkConfig extends GenericNetworkConfig> =
	| DisconectedNetworkState
	| DisconectedBecauseNotSupportedNetworkState
	| ConnectedNetworkState<NetworkConfig>;

type BaseNetworkState = {
	error?: ConnectionError;
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

export type ConnectedNetworkState<NetworkConfig extends GenericNetworkConfig> = BaseNetworkState & {
	state: 'Connected';
	fetchingChainId: false;
	chainId: string;
	loading: false;
	notSupported: false;
	contracts: NetworkConfig['contracts'];
};

type BaseAccountState = {
	error?: ConnectionError;
};

export type AccountState = ConnectedAccountState | DisconnectedAccountState;

export type ConnectedAccountState = BaseAccountState & {
	state: 'Connected';
	locked: false;
	unlocking: false;
	address: `0x${string}`;
	loadingData: undefined;
	loadingStep: undefined;
};

export type DisconnectedAccountState = BaseAccountState & {
	state: 'Disconnected';
	locked: boolean;
	unlocking: boolean;
	address?: `0x${string}`;
	loadingData?: string;
	loadingStep?: string;
};

export type OnConnectionExecuteState = {
	connection: ConnectedState;
};
export type ConnectAndExecuteCallback<T> = (state: OnConnectionExecuteState) => Promise<T>;

export type OnExecuteState<NetworkConfig extends GenericNetworkConfig> = {
	connection: ConnectedState;
	account: ConnectedAccountState;
	network: ConnectedNetworkState<NetworkConfig>;
};
export type ExecuteCallback<NetworkConfig extends GenericNetworkConfig, T> = (
	state: OnExecuteState<NetworkConfig>
) => Promise<T>;

export type ExecutionState = {
	executing: boolean;
	requireUserConfirmation?: boolean;
	error?: ConnectionError;
};

export type ConnectionConfig<NetworkConfig extends GenericNetworkConfig> = {
	options?: (string | Web3WModule | Web3WModuleLoader)[];
	autoConnectUsingPrevious?: boolean;
	networks?: NetworkConfigs<NetworkConfig>;
	defaultRPC?: { chainId: string; url: string }; // TODO per chain ?
	acccountData?: {
		loadWithNetworkConnected: (
			state: {
				address: `0x${string}`;
				connection: ConnectedState;
				network: DisconectedBecauseNotSupportedNetworkState | ConnectedNetworkState<NetworkConfig>;
			},
			setLoadingMessage: (msg: string) => void,
			waitForStep: (stepName?: string) => Promise<unknown>
		) => Promise<void>;
		unload: () => Promise<void>;
	};
	observers?: EIP1193Observers;
};

export function init<NetworkConfig extends GenericNetworkConfig>(
	config: ConnectionConfig<NetworkConfig>
) {
	// ----------------------------------------------------------------------------------------------
	// Arguments Consumption
	// ----------------------------------------------------------------------------------------------
	const options =
		!config.options || config.options.length === 0 ? ['builtin'] : [...config.options];
	const optionsAsStringArray = options.map((m) => {
		if (typeof m === 'object') {
			if (!m.id) {
				throw new Error('options need to be string or have an id');
			}
			return m.id;
		}
		return m;
	});
	// ----------------------------------------------------------------------------------------------

	// ----------------------------------------------------------------------------------------------
	// private state
	// ----------------------------------------------------------------------------------------------
	let listening: boolean = true;
	let currentModule: Web3WModule | undefined;
	// ----------------------------------------------------------------------------------------------

	// ----------------------------------------------------------------------------------------------
	// STORES
	// ----------------------------------------------------------------------------------------------
	const builtin = createBuiltinStore(globalThis.window);

	const { $state, set, readable } = createStore<ConnectionState>({
		state: 'Disconnected',
		initialised: false,
		connecting: false,
		requireSelection: false,
		loadingModule: false,
		provider: undefined,
		walletType: undefined,
		defaultProvider: config.defaultRPC ? createRPCProvider(config.defaultRPC) : undefined,

		toJSON(): Partial<ConnectionState> {
			return {
				...$state,
				provider: undefined,
				defaultProvider: undefined,
			};
		},
	});

	const {
		$state: $network,
		set: setNetwork,
		readable: readableNetwork,
	} = createStore<NetworkState<NetworkConfig>>({
		state: 'Disconnected',
		fetchingChainId: false,
		loading: false,
		chainId: undefined,
		notSupported: undefined,
		contracts: undefined,
	});
	const {
		$state: $account,
		set: _setAccount,
		readable: readableAccount,
	} = createStore<AccountState>({
		state: 'Disconnected',
		locked: false,
		unlocking: false,
	});

	const setAccount: typeof _setAccount = (data) => {
		console.log(`for : ${$account.address}`, data);

		if ('address' in data && !data.address) {
			console.log(`UNDEFINED address`);
		}

		_setAccount(data);
		if ($account.state === 'Connected' && $account.locked) {
			console.error(`invariant broken, connected and locked not possible`);
		}
	};

	const {
		$state: $execution,
		set: setExecution,
		readable: readableExecution,
	} = createStore<ExecutionState>({
		executing: false,
	});

	const { observers: observersForPendingActions, pendingActions } = createPendingActionsStore();
	// ----------------------------------------------------------------------------------------------

	// ----------------------------------------------------------------------------------------------
	// function to create the provider
	// ----------------------------------------------------------------------------------------------

	const observers = config.observers
		? multiObersvers([config.observers, observersForPendingActions])
		: observersForPendingActions;

	function createProvider(ethereum: EIP1193Provider): EIP1193Provider {
		return wrapProvider(ethereum, observers);
	}
	// ----------------------------------------------------------------------------------------------

	// ----------------------------------------------------------------------------------------------
	// attempt to wrap window.ethereum so all request are captured, no matter how you want to handle it
	// ----------------------------------------------------------------------------------------------
	try {
		if (globalThis.window.ethereum) {
			// try to wrap the ethereum object if possible
			globalThis.window.ethereum = createProvider(globalThis.window.ethereum);
		}
	} catch (err) {
		logger.info(err);
	}
	// ----------------------------------------------------------------------------------------------

	function hasChainChanged(chainId: string): boolean {
		return chainId !== $network.chainId;
	}

	async function onChainChanged(chainId: string) {
		if (config.defaultRPC && $state.defaultProvider) {
			if (chainId === config.defaultRPC.chainId) {
				// make use of the user's chosen wallet provider
				$state.defaultProvider.fallbackOn($state.provider);
			} else {
				// go back to rpc requests
				$state.defaultProvider.fallbackOn(undefined);
			}
		}
		if (chainId === '0xNaN') {
			logger.warn('onChainChanged bug (return 0xNaN), Metamask bug?');
			if (!$state.provider) {
				throw new Error('no provider to get chainId');
			}
			// TODO handle this indeterminate state where we know thw chain changed but we do not know yet the new chain
			chainId = await $state.provider.request({ method: 'eth_chainId' });
		}
		const chainIdAsDecimal = formatChainId(chainId);
		if (hasChainChanged(chainIdAsDecimal)) {
			logger.debug('onChainChanged', { chainId, chainIdAsDecimal });
			const needToLoadAccountData =
				config.acccountData && 'loadWithNetworkConnected' in config.acccountData;
			try {
				if (needToLoadAccountData) {
					setAccount({ state: 'Disconnected', loadingData: 'Loading Network...' });
				}
				await handleNetwork(chainIdAsDecimal);
				if (needToLoadAccountData) {
					setAccount({ state: 'Disconnected', loadingData: 'Loading account...' });
				}
				await handleAccount($account.address, chainIdAsDecimal);
			} catch (err) {
				if (needToLoadAccountData) {
					setAccount({
						state: 'Disconnected',
						loadingData: undefined,
						loadingStep: undefined,
						error: err as any,
					}); // TODO any
					_connect.resolve(['connection+account', 'connection+network+account'], false);
				}
				console.error(err);
			}
		}
	}

	async function updateContractsInfos(newNetworkConfig: NetworkConfig) {
		config.networks = newNetworkConfig;
		if ($network.chainId) {
			handleNetwork($network.chainId);
		}
	}

	async function handleNetwork(chainId: string) {
		try {
			if (!config.networks) {
				setNetwork({
					state: 'Connected',
					chainId,
					notSupported: false,
					contracts: {},
				});
			} else {
				let networkConfigs = config.networks;
				if (typeof networkConfigs === 'function') {
					setNetwork({
						chainId,
						loading: true,
					});
					networkConfigs = await networkConfigs(chainId);
				}

				// TODO cache
				const contractsInfos = getContractInfos(networkConfigs, chainId);
				if (contractsInfos) {
					setNetwork({
						state: 'Connected',
						chainId,
						loading: false,
						notSupported: false,
						contracts: contractsInfos,
					});
				} else {
					setNetwork({
						state: 'Disconnected',
						chainId,
						loading: false,
						notSupported: true,
						contracts: undefined,
					});
				}
			}
			if (!$network.notSupported) {
				if ($account.state === 'Connected') {
					_connect.resolve('connection+network+account', true);
				} else {
					_connect.resolve('connection+network', true);
				}
			}
		} catch (err) {
			_connect.reject(['connection+network+account', 'connection+network'], err);
			throw err;
		}
	}

	async function pollAccountsChanged(callback: (accounts: `0x${string}`[]) => void) {
		while ($state.provider) {
			await wait(3000); // TODO config
			if (!listening) {
				break;
			}

			if (!$state.provider) {
				logger.error(`no provider anymore, but we are still listening !!!???`);
			}
			let accounts: `0x${string}`[] = [];
			try {
				accounts = await $state.provider.request({ method: 'eth_accounts' });
			} catch (err) {
				logger.error(err);
			}

			// logger.debug({ accounts }); // TODO remove
			if (hasAccountsChanged(accounts)) {
				try {
					callback(accounts);
				} catch (e) {
					logger.error(e);
					// TODO error in $connection.error ?
				}
			}
		}
	}

	let lastAccount: `0x${string}` | undefined;
	function hasAccountsChanged(accounts: `0x${string}`[]): boolean {
		return accounts[0] !== lastAccount;
		// TODO multi account support ?
	}

	async function onAccountsChanged(accounts: `0x${string}`[]) {
		if (!hasAccountsChanged(accounts)) {
			logger.debug('false account changed', accounts);
			return;
		}

		logger.debug('onAccountsChanged', { accounts }); // TODO
		const address = accounts[0];
		lastAccount = address;
		handleAccount(address);
	}

	function listenForChanges() {
		if ($state.provider && !listening) {
			logger.log('LISTENNING');
			$state.provider.on('chainChanged', onChainChanged);
			$state.provider.on('accountsChanged', onAccountsChanged);

			listening = true;

			// still poll has accountsChanged does not seem to be triggered all the time
			// this issue was tested in Metamask back in web3w, // TOCHECK
			// in Brave this issue happen for lock when invoked first time, see : https://github.com/brave/brave-browser/issues/28688
			pollAccountsChanged(onAccountsChanged);
		}
	}

	function stopListeningForChanges() {
		if ($state.provider && listening) {
			logger.log('STOP LISTENNING');
			$state.provider.removeListener('chainChanged', onChainChanged);
			$state.provider.removeListener('accountsChanged', onAccountsChanged);
			listening = false;
		}
	}

	async function fetchChainId() {
		// TODO check if reseting to Disconnected is good here
		// for now we assert
		if ($network.state === 'Connected') {
			throw new Error(`supposed to fetch chain id only when disconnected`);
		}
		try {
			setNetwork({
				state: 'Disconnected',
				fetchingChainId: true,
				chainId: undefined,
				loading: false,
				notSupported: undefined,
				contracts: undefined,
			});
			const chainId = await $state.provider?.request({ method: 'eth_chainId' });
			if (chainId) {
				const chainIdAsDecimal = formatChainId(chainId);
				setNetwork({
					state: 'Disconnected',
					fetchingChainId: false,
					chainId: chainIdAsDecimal,
					loading: false,
					notSupported: undefined,
					contracts: undefined,
				});
			}
		} catch (err) {
			setNetwork({
				state: 'Disconnected',
				fetchingChainId: false,
				chainId: undefined,
				loading: false,
				notSupported: undefined,
				contracts: undefined,
			});
			throw err;
		}
	}

	async function select(type: string, config?: { moduleConfig?: any; autoUnlock: boolean }) {
		const { moduleConfig, autoUnlock: autoUnlockFromConfig } = config || { autoUnlock: true };
		const autoUnlock = autoUnlockFromConfig === undefined ? true : autoUnlockFromConfig;

		logger.log(`select...`);
		try {
			if ($state.state === 'Connected') {
				// disconnect first
				logger.log(`disconnecting for select...`);
				await disconnect();
			}

			let typeOrModule: string | Web3WModule | Web3WModuleLoader = type;

			if (!typeOrModule) {
				if (options.length === 0) {
					typeOrModule = 'builtin';
				} else if (options.length === 1) {
					typeOrModule = options[0];
				} else {
					const message = `No Wallet Type Specified, choose from ${optionsAsStringArray}`;
					// set(walletStore, {error: {message, code: 1}}); // TODO code
					throw new Error(message);
				}
			}
			if (
				typeOrModule == 'builtin' &&
				builtin.$state.state === 'Ready' &&
				!builtin.$state.available
			) {
				const message = `No Builtin Wallet`;
				// set(walletStore, {error: {message, code: 1}}); // TODO code
				throw new Error(message);
			} // TODO other type: check if module registered

			set({
				connecting: true,
			});
			if (typeOrModule === 'builtin') {
				logger.log(`probing window.ethereum...`);
				const builtinProvider = await builtin.probe();
				logger.log(builtinProvider);
				if (!builtinProvider) {
					const message = `no window.ethereum found!`;
					set({
						connecting: false,
						error: { message, code: 1 }, // TODO code
					});
					throw new Error(message);
				}

				set({
					requireSelection: false,
					walletType: { type, name: walletName(type) },
					provider: createProvider(builtinProvider),
				});

				currentModule = undefined;
			} else {
				let module: Web3WModule | Web3WModuleLoader | undefined;
				if (typeof typeOrModule === 'string') {
					if (options) {
						for (const choice of options) {
							if (typeof choice !== 'string' && choice.id === type) {
								module = choice;
							}
						}
					}
				} else {
					module = typeOrModule;
					type = module.id;
				}

				if (!module) {
					const message = `no module found: ${type}`;
					set({
						connecting: false,
						error: { message, code: 1 }, // TODO code
					});
					throw new Error(message);
				}

				try {
					set({
						loadingModule: true,
					});
					if ('load' in module) {
						// if (module.loaded) {
						//   module = module.loaded;
						// } else {

						module = await module.load();

						// }
					}

					logger.log(`setting up module`);
					const moduleSetup = await module.setup(moduleConfig); // TODO pass config in select to choose network

					set({
						loadingModule: false,
					});

					currentModule = module;
					await handleNetwork(moduleConfig.chainId);
					set({
						requireSelection: false,
						walletType: { type, name: walletName(type) },
						provider: createProvider(
							(moduleSetup as any).eip1193Provider || (moduleSetup as any).web3Provider
						),
					});
					logger.log(`module setup`);
				} catch (err) {
					currentModule = undefined;
					set({
						connecting: false,
						requireSelection: false,
						loadingModule: false,
					});
					_connect.reject('*', err);
					return;
					// TODO detect real errors vs cancellation
					// if ((err as any).message === 'USER_CANCELED') {
					// 	set({
					// 		connecting: false,
					// 		selected: undefined,
					// 		walletName: undefined,
					// 		loadingModule: false,
					// 	});
					// } else {
					// 	set({
					// 		error: { code: MODULE_ERROR, message: (err as any).message },
					// 		selected: undefined,
					// 		walletName: undefined,
					// 		connecting: false,
					// 		loadingModule: false,
					// 	});
					// }
					// throw err;
				}
			}

			if (!$state.provider || !$state.walletType) {
				const message = `no wallet found for wallet type ${type}`;
				set({
					connecting: false,
					error: { message, code: 1 }, // TODO code
				});
				throw new Error(message);
			}

			recordSelection(type);

			// TODO better naming/flow ?
			try {
				await fetchChainId();
			} catch (err) {
				// cannot fetch chainId, this means we are not connected
				set({
					connecting: false,
					walletType: $state.walletType,
					provider: $state.provider,
				});
				_connect.reject('*', err);
				return;
			}

			if (!$network.chainId) {
				const message = `no chainId set`;
				set({
					connecting: false,
					error: { message, code: 1 }, // TODO code
				});
				throw new Error(message);
			}

			// everything passed
			set({
				state: 'Connected',
				connecting: false,
				requireSelection: false,
				loadingModule: false,
				walletType: $state.walletType,
				provider: $state.provider,
				// error: undefined, // DO we need that ?
			});
			listenForChanges();
			_connect.resolve('connection', true);

			try {
				await handleNetwork($network.chainId);
				await fetchAccount($state.provider, autoUnlock);
			} catch (err) {
				console.error(err);
			}
		} catch (err) {
			logger.log(`select error`, err);
			set({
				state: 'Disconnected',
				connecting: false,
				requireSelection: false,
				loadingModule: false,
				walletType: $state.walletType,
				provider: $state.provider,
				error: (err as any).message || err,
			});
			throw err;
		}
	}

	// const _loadData = createManageablePromiseWithId();

	// function loadData(address: `0x${string}`): Promise<unknown> {
	// 	return _loadData.promise(address, async (resolve, reject) => {

	// 	});
	// }

	let accountDataLoaded: `0x${string}` | undefined; // TODO 0xstring
	let accountDataUnloading: `0x${string}` | undefined; // TODO 0xstring
	let accountDataLoading: `0x${string}` | undefined; // TODO 0xstring
	let loadCounter = 0;

	// let accountUpdateCounter: number = 0;
	// TODO? nativeTOken balance, token balances ?
	async function handleAccount(address: `0x${string}` | undefined, newChainId?: string) {
		let loadCounterUsed = loadCounter;
		const chainId = newChainId || $network.chainId;
		// let counter = ++accountUpdateCounter;
		if (address) {
			if (config.acccountData) {
				try {
					if (
						$network.state === 'Connected' ||
						($network.state === 'Disconnected' && $network.notSupported)
					) {
						if (address !== accountDataLoaded || newChainId) {
							if (accountDataLoaded) {
								accountDataLoaded = address;
								setAccount({
									address,
									locked: false,
									unlocking: false,
									loadingData: `Unloading... for ( ${address})`,
									state: 'Disconnected',
								});
								try {
									loadCounterUsed = ++loadCounter;
									await config.acccountData.unload();
								} catch (err) {}
								// if (counter < accountUpdateCounter) {
								// 	return;
								// }
								if (loadCounterUsed != loadCounter) {
									console.log(`change of address or network, stop right there, before loading`);
									return;
								}

								setAccount({ loadingData: `Loading... ${address}` });
							} else {
								accountDataLoaded = address;
								setAccount({
									loadingData: `Loading... ${address}`,
									address,
									locked: false,
									unlocking: false,
								});
							}
							try {
								console.log(`BEFORE LOAD`, JSON.stringify($account, null, 2));
								await config.acccountData.loadWithNetworkConnected(
									{
										address,
										connection: $state as ConnectedState,
										network: $network as
											| DisconectedBecauseNotSupportedNetworkState
											| ConnectedNetworkState<NetworkConfig>,
									},
									(msg: string) => {
										setAccount({ loadingData: msg || $account.loadingData });
									},
									(stepName?: string) => {
										setAccount({ loadingStep: stepName || 'WaitingForConfirmation' });
										return _accountLoadingStep.promise().finally(() => {
											setAccount({ loadingStep: undefined });
										});
									}
								);

								if (loadCounterUsed != loadCounter) {
									console.log(`change of address or network, stop right there`);
									return;
								}

								// if (counter < accountUpdateCounter) {
								// 	return;
								// }
								setAccount({
									loadingData: undefined,
									loadingStep: undefined,
								});

								if (!$account.locked && $account.address) {
									setAccount({
										state: 'Connected',
									});
									if ($network.state === 'Connected') {
										_connect.resolve('connection+network+account', true);
									} else {
										_connect.resolve('connection+account', true);
									}
								} else {
									console.log(`CHANGE`, JSON.stringify($account, null, 2));
								}
							} catch (err) {
								if (loadCounterUsed != loadCounter) {
									console.log(
										`change of address or network, stop right there, ignore loading error`
									);
									return;
								}
								console.error(`ERROR`, err);
								accountDataLoaded = undefined;
								setAccount({
									state: 'Disconnected',
									// locked: false,
									loadingData: undefined,
									loadingStep: undefined,
									error: err as any,
								});
								_connect.resolve(['connection+account', 'connection+network+account'], false);
							}
						} else {
							if ($account.state !== 'Connected') {
								setAccount({
									state: 'Connected',
									address,
									locked: false,
									unlocking: false,
								});
								if (!$account.loadingData) {
									if ($network.state === 'Connected') {
										_connect.resolve('connection+network+account', true);
									} else {
										_connect.resolve('connection+account', true);
									}
								}
							}
						}
					} else {
						setAccount({
							state: 'Disconnected',
							locked: false,
							unlocking: false,
							address,
							loadingData: 'Waiting for Network...',
						});
						_connect.resolve(['connection+account', 'connection+network+account'], false);
					}
				} catch (err) {
					setAccount({
						state: 'Disconnected',
						locked: false,
						unlocking: false,
						address,
						loadingData: undefined,
						loadingStep: undefined,
						error: err as any,
					});
					_connect.resolve(['connection+account', 'connection+network+account'], false);
				}
			} else {
				setAccount({ state: 'Connected', locked: false, address, unlocking: false });
				if ($network.state === 'Connected') {
					_connect.resolve('connection+network+account', true);
				} else {
					_connect.resolve('connection+account', true);
				}
			}
		} else {
			// we keep the last address here : ($account.address)
			setAccount({
				state: 'Disconnected',
				locked: true,
				address: $account.address,
			});
			_connect.resolve(['connection+account', 'connection+network+account'], false);
		}
	}

	async function fetchAccount(provider: EIP1193Provider, autoUnlock: boolean) {
		let accounts: `0x${string}`[];
		try {
			try {
				logger.log(`fetching accounts...`);
				accounts = await provider.request({ method: 'eth_accounts' });
			} catch (err) {
				const errWithCode = err as { code: number; message: string };
				if (errWithCode.code === 4100) {
					logger.log(`4100 ${errWithCode.message || (errWithCode as any).name}`); // TOCHECK why name here ?
					// status-im throw such error if eth_requestAccounts was not called first
					accounts = [];
				} else if (errWithCode.code === -32500 && errWithCode.message === 'permission denied') {
					accounts = [];
				} else if (errWithCode.code === 4001) {
					// "No Frame account selected" (frame.sh)
					accounts = [];
				} else {
					throw err;
				}
			}
			logger.log(`accounts: ${accounts}`);
			// }
		} catch (err) {
			const errWithCode = err as { code: number; message: string };
			set({
				error: errWithCode, // TODO remove $account.error and $network.error ?
			});
			_connect.reject(['connection+account', 'connection+network+account'], err);
			throw err;
		}
		logger.debug({ accounts });
		const address = accounts && accounts[0];
		handleAccount(address);
		if ($account.locked && autoUnlock) {
			return unlock();
		}
	}

	async function disconnect(): Promise<void> {
		stopListeningForChanges();
		setAccount({ state: 'Disconnected', locked: false, unlocking: false, address: undefined });
		setNetwork({
			state: 'Disconnected',
			fetchingChainId: false,
			chainId: undefined,
			loading: false,
			notSupported: undefined,
			contracts: undefined,
		});
		const moduleToDisconnect = currentModule;
		currentModule = undefined;
		set({
			state: 'Disconnected',
			connecting: false,
			requireSelection: false,
			loadingModule: false,
			walletType: undefined,
			provider: undefined,
		});
		recordSelection('');
		_connect.resolve('*', false);
		if (moduleToDisconnect) {
			await moduleToDisconnect.disconnect();
		}
	}

	const _connect = createManageablePromiseWithId<boolean>();

	const _accountLoadingStep = createManageablePromise();

	function connect(
		requirements: ConnectionRequirements = 'connection+network+account'
	): Promise<boolean> {
		return _connect.promise(requirements, async (resolve, reject) => {
			let type: string | undefined;
			if (!type) {
				if (optionsAsStringArray.length === 0) {
					type = 'builtin';
				} else if (optionsAsStringArray.length === 1) {
					type = optionsAsStringArray[0];
				}
			}
			if ($state.state === 'Connected') {
				if ($network.state === 'Connected') {
					if ($account.state !== 'Connected') {
						if ($account.locked) {
							await unlock();
						} else {
							handleAccount($account.address);
						}
					}
				} else {
					if ($network.chainId) {
						await handleNetwork($network.chainId);
					} else {
						await fetchChainId();
						await handleNetwork($network.chainId as string); // should be good
					}
					if ($account.locked) {
						await unlock();
					}
				}
			} else {
				set({
					connecting: true,
				});
				if (!type) {
					await builtin.probe();
					set({
						requireSelection: true,
					});
				} else {
					select(type).catch((err) => {
						_connect.reject('*', err);
						throw err;
					});
				}
			}
		});
	}

	function cancel() {
		set({
			state: 'Disconnected',
			connecting: false,
			requireSelection: false,
			loadingModule: false,
			walletType: undefined,
			provider: undefined,
		});
		// resolve all connection attempt as false, including execution
		_connect.resolve('*', false);
	}

	function walletName(type: string): string | undefined {
		return type === 'builtin' ? builtin.$state.vendor : type;
	}

	async function cancelUnlock() {
		// this does not actually stop unlocking
		readable.acknowledgeError();
		setAccount({
			unlocking: false,
		});
		_connect.resolve(['connection+account', 'connection+network+account'], false);
	}

	async function unlock() {
		if ($account.locked) {
			setAccount({
				unlocking: true,
			});
			let accounts: `0x${string}`[] | undefined;
			try {
				accounts = await $state.provider?.request({ method: 'eth_requestAccounts' });
				accounts = accounts || [];
			} catch (err) {
				const errWithCode = err as EIP1193ProviderRpcError;
				switch ($state.walletType?.name) {
					case 'Metamask':
						if (
							errWithCode.code === -32002 &&
							// TODO do not make this dependent on message but need to ensure 32002 will not be triggered there for other cases
							(errWithCode.message.includes(
								'Already processing eth_requestAccounts. Please wait.'
							) ||
								errWithCode.message.includes(
									`Request of type 'wallet_requestPermissions' already pending`
								))
						) {
							set({
								error: {
									message: `To unlock your wallet, please click on the Metamask add-on's icon and unlock from there.`,
									code: 10000,
								},
							});
							// we ignore the error
							_connect.resolve(['connection+account', 'connection+network+account'], false);
							return;
						}
						break;
					case 'Brave':
						if (
							errWithCode.code === 4001 &&
							// TODO this is silly, Brave reject this error if the lock screen is dismissed, yet it does not even highlight that a request was there, like Metamask do
							errWithCode.message.includes('The user rejected the request.')
						) {
							set({
								error: {
									message: `To unlock your wallet, please click on the Brave wallet's icon and unlock from there.`,
									code: 1000,
								},
							});
							// we ignore the error
							_connect.resolve(['connection+account', 'connection+network+account'], false);
							return;
						}
						break;
				}

				logger.error(err); // TODO Frame account selection ?
				accounts = [];
			}
			const address = accounts[0];
			if (address) {
				setAccount({
					unlocking: false,
				});
			}
			handleAccount(address);
		} else {
			const message = `Not Locked`;
			_connect.reject(['connection+account', 'connection+network+account'], { message, code: 1 }); // TODO code
			throw new Error(message);
		}
	}

	async function connectAndExecute<T>(
		callback: ConnectAndExecuteCallback<T>
	): Promise<T | undefined> {
		if ($state.state === 'Connected') {
			return callback({
				connection: $state as ConnectedState,
			});
		}
		return new Promise((resolve, reject) => {
			connect('connection')
				.then((connected) => {
					if (connected) {
						callback({
							connection: $state as unknown as ConnectedState, // this is because connected means we are in "Connected" state // TODO double check or assert
						}).then(resolve);
					} else {
						resolve(undefined); // resolve silently without executing
						// reject(new Error(`not connected`));
					}
				})
				.catch((err) => {
					reject(err);
				});
		});
	}

	async function execute<T>(
		callback: ExecuteCallback<NetworkConfig, T>
		//options?: { requireUserConfirmation?: boolean }
	): Promise<T | undefined> {
		setExecution({ executing: true });
		if (
			$state.state === 'Connected' &&
			$network.state === 'Connected' &&
			$account.state === 'Connected'
		) {
			// TODO remove this or above (above should be another state : executeRequirements or we could have a separate store for execution)
			setExecution({ executing: true });
			return callback({
				connection: $state as ConnectedState,
				account: $account as ConnectedAccountState,
				network: $network as ConnectedNetworkState<NetworkConfig>,
			}).finally(() => {
				setExecution({ executing: false });
			});
		}
		// if (options?.requireUserConfirmation) {
		// 	set({ executionRequireUserConfirmation: true });
		// }
		return new Promise((resolve, reject) => {
			connect('connection+network+account')
				.then((connected) => {
					if (connected) {
						// TODO remove this or above (above should be another state : executeRequirements or we could have a separate store for execution)
						setExecution({ executing: true });
						callback({
							connection: $state as unknown as ConnectedState, // this is because connected means we are in "Connected" state // TODO double check or assert
							account: $account as ConnectedAccountState,
							network: $network as ConnectedNetworkState<NetworkConfig>,
						})
							.finally(() => {
								setExecution({ executing: false });
							})
							.then(resolve);
					} else {
						setExecution({ executing: false });
						resolve(undefined); // resolve silently without executing
						// reject(new Error(`not connected`));
					}
				})
				.catch((err) => {
					setExecution({ executing: false });
					reject(err);
				});
		});
	}

	async function cancelExecution() {
		if ($execution.executing) {
			_connect.resolve('*', false);
		}
	}

	async function switchTo(
		chainId: string,
		config?: {
			rpcUrls?: string[];
			blockExplorerUrls?: string[];
			chainName?: string;
			iconUrls?: string[];
			nativeCurrency?: {
				name: string;
				symbol: string;
				decimals: number;
			};
		}
	) {
		if (!$state.provider) {
			// TODO? autoConnect ?
			throw new Error(`no provider setup`);
		}
		try {
			// attempt to switch...
			const result = await $state.provider.request({
				method: 'wallet_switchEthereumChain',
				params: [
					{
						chainId: ('0x' + parseInt(chainId).toString(16)) as EIP1193ChainId,
					},
				],
			});
			if (!result) {
				// handleNetwork(chainId);
			} else {
				throw result;
			}
		} catch (err) {
			if ((err as any).code === 4902) {
				if (config && config.rpcUrls && config.rpcUrls.length > 0) {
					try {
						const result = await $state.provider.request({
							method: 'wallet_addEthereumChain',
							params: [
								{
									chainId: ('0x' + parseInt(chainId).toString(16)) as EIP1193ChainId,
									rpcUrls: config.rpcUrls,
									chainName: config.chainName,
									blockExplorerUrls: config.blockExplorerUrls,
									iconUrls: config.iconUrls,
									nativeCurrency: config.nativeCurrency,
								},
							],
						});
						if (!result) {
							// handleNetwork(chainId);
						} else {
							// TODO error ?
						}
					} catch (err) {
						if ((err as any).code !== 4001) {
							set({
								error: err as any, // TODO
							});
						} else {
							return;
						}
					}
				} else {
					set({
						error: {
							code: 1, // TODO CHAIN_NOT_AVAILABLE_ON_WALLET,
							message: 'Chain not available on your wallet',
						},
					});
				}
			} else {
				if ((err as any).code !== 4001) {
					set({
						error: err as any, // TODO
					});
				} else {
					return;
				}
			}
		}
	}

	async function autoStart() {
		let timeout: number | undefined;
		try {
			timeout = setTimeout(() => {
				// set({
				// 	initialised: true,
				// 	error: {
				// 		code: 7221,
				// 		message: 'Your wallet seems to not respond, please reload.',
				// 	},
				// });
				set({ initialised: true, connecting: false });
			}, 2000);
			const type = fetchPreviousSelection();
			if (type && type !== '') {
				await select(type, { autoUnlock: false });
			}
		} finally {
			clearTimeout(timeout);
			set({
				initialised: true,
			});
		}
	}

	if (typeof window !== 'undefined') {
		if (config.autoConnectUsingPrevious) {
			autoStart();
		} else {
			set({
				initialised: true,
			} as any); // TODO ensure we can set initilaized alone
		}
	}

	return {
		connection: {
			...readable,
			options: optionsAsStringArray,
			builtin,
			connect,
			select,
			cancel,
			disconnect,
			updateContractsInfos,
		},
		network: {
			...readableNetwork,
			switchTo,
		},
		account: {
			...readableAccount,
			unlock,
			cancelUnlock,
			acceptLoadingStep(value?: unknown) {
				_accountLoadingStep.resolve(value);
			},
			rejectLoadingStep(value?: unknown) {
				_accountLoadingStep.reject(value);
			},
		},
		pendingActions,
		execution: {
			...readableExecution,
			cancel: cancelExecution,
		},
		execute,
	};
}

// if (import.meta.hot) {
// 	import.meta.hot.accept((newModule) => {
// 		if (newModule) {
// 			console.log('web3-connection/connection updated');
// 		}
// 	});
// }

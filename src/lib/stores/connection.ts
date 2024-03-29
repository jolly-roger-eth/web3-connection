import type { Web3WModule, Web3WModuleLoader } from '$lib/types/modules';
import { createStore } from '$lib/utils/stores';
import { createBuiltinStore } from './builtin';
import { logs } from 'named-logs';
import { wait } from '$lib/utils/time';
import { formatChainId } from '$lib/utils/ethereum';
import { multiObersvers, wrapProvider, type WrappProviderConfig } from '$lib/provider/wrap';
import type { EIP1193Observers, Web3ConnectionProvider } from '$lib/provider/types';
import { createPendingActionsStore } from './pending-actions';
import { createManageablePromise, createManageablePromiseWithId } from '$lib/utils/promises';
import { getSingleNetworkConfig } from '$lib/utils/contracts';
import { fetchPreviousSelection, recordSelection } from './localStorage';
import type {
	EIP1193Block,
	EIP1193ChainId,
	EIP1193Message,
	EIP1193Provider,
	EIP1193ProviderRpcError,
	EIP1193ProviderWithoutEvents,
	EIP1193Request,
} from 'eip-1193';
import { createRPCProvider } from '$lib/provider/rpc';
import { initEmitter } from '$lib/external/callbacks';
import type { EIP1193ProviderWithBlocknumberSubscription } from '$lib/provider/types';
import {
	acknowledgeBlockCacheIssue,
	checkBlockHeight,
	checkGenesis,
	hasPreviouslyEncounteredBlocksCacheIssue,
	isNonceCached,
	recordBlockCacheIssue,
} from '$lib/utils/chain';
import type { Address } from 'abitype';
import type {
	AccountState,
	ChainInfo,
	ConnectAndExecuteCallback,
	ConnectedAccountState,
	ConnectedNetworkState,
	ConnectedState,
	ConnectionConfig,
	ConnectionRequirements,
	ConnectionState,
	DisconectedBecauseNotSupportedNetworkState,
	ExecuteCallback,
	ExecutionState,
	GenericContractsInfos,
	NetworkConfigs,
	NetworkState,
	Parameters,
	ParametersPerNetwork,
} from './types';
import { timeoutRequest, type Timeout } from './utils';

const logger = logs('web3-connection');

export function init<ContractsInfos extends GenericContractsInfos>(
	config: ConnectionConfig<NetworkConfigs<ContractsInfos>, ContractsInfos>,
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
	const defaultParams =
		config.parameters && 'default' in config.parameters
			? config.parameters.default
			: {
					finality: 12,
					blockTime: 5,
					timeout: 2,
				};
	const parameters: ParametersPerNetwork = config.parameters
		? 'finality' in config.parameters
			? {
					default: config.parameters as Parameters,
				}
			: (config.parameters as ParametersPerNetwork)
		: {
				default: defaultParams,
			};
	// ----------------------------------------------------------------------------------------------

	// ----------------------------------------------------------------------------------------------
	// private state
	// ----------------------------------------------------------------------------------------------
	let listening: boolean = false;
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

		toJSON(): Partial<ConnectionState> {
			return {
				...$state,
				provider: undefined,
			};
		},
	});

	const {
		$state: $network,
		set: setNetwork,
		readable: readableNetwork,
	} = createStore<NetworkState<ContractsInfos>>({
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
	} = createStore<AccountState<Address>>({
		state: 'Disconnected',
		fetching: false,
		locked: false,
		unlocking: false,
	});

	const setAccount: typeof _setAccount = (data) => {
		// console.log(`for : ${$account.address}`, data);

		// if ('address' in data && !data.address) {
		// 	console.log(`UNDEFINED address`);
		// }

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
	const emitter = initEmitter<number>();

	function onNewBlock(func: (blockNumber: number) => void) {
		return emitter.on(func);
	}
	function offNewBlock(func: (blockNumber: number) => void) {
		return emitter.off(func);
	}

	let lastBlockNumberEmitted: number | undefined;
	function emitNewBlockIfNotAlreadyEmitted(blockNumber: number) {
		if (!lastBlockNumberEmitted || lastBlockNumberEmitted != blockNumber) {
			lastBlockNumberEmitted = blockNumber;
			emitter.emit(blockNumber);
		}
	}

	let timer: Timeout | undefined;
	let subscriptionId: `0x${string}` | undefined;
	async function handleNewHeads(
		provider: EIP1193ProviderWithBlocknumberSubscription,
		oldProvider?: EIP1193ProviderWithBlocknumberSubscription,
	) {
		if (subscriptionId && oldProvider) {
			oldProvider
				.request({
					method: 'eth_unsubscribe',
					params: [subscriptionId],
				})
				.catch((err: any) => {
					console.error(`failed to unsubscribe from newHeads`, err);
				});
		}

		const networkParams: Parameters = {
			defaultParams,
			...($network.chainId ? parameters[$network.chainId] : parameters.default),
		} as any;

		const timerDelay = Math.max((networkParams.blockTime * 1000) / 2, 1000);

		let timer_lastBlockNumber: number | undefined;
		let timer_lastBlockTime: number | undefined;
		// let timer_lastCurrenTime: number | undefined;
		let timer_lastChainId: string | undefined;
		let pending_request: Promise<EIP1193Block | null> | undefined;
		async function checkLatestBlock() {
			if (!pending_request && $network.chainId) {
				pending_request = provider.request({
					method: 'eth_getBlockByNumber',
					params: ['latest', false],
				});
				const block = await pending_request;
				if (!block) {
					throw new Error(`cannot fetch latest block`);
				}
				pending_request = undefined;
				// const currenTime = provider.currentTime();

				const blockNumber = Number(block.number);

				if (
					$network.chainId !== timer_lastChainId ||
					!timer_lastBlockNumber ||
					blockNumber > timer_lastBlockNumber
				) {
					const blockTimestamp = Number(block.timestamp);
					timer_lastChainId = $network.chainId;
					timer_lastBlockNumber = blockNumber;
					timer_lastBlockTime = blockTimestamp;

					emitNewBlockIfNotAlreadyEmitted(blockNumber);

					single_provider?.syncBlock(block);
				}
			}
		}
		async function onTimer() {
			try {
				await checkLatestBlock();
			} finally {
				timer = setTimeout(onTimer, timerDelay);
			}
		}

		if (!timer) {
			onTimer();
		}

		try {
			const newSubscriptionId = await provider.request({
				method: 'eth_subscribe',
				params: ['newHeads'],
			});
			subscriptionId = newSubscriptionId as `0x${string}`;
			try {
				provider.on('message', (message: EIP1193Message) => {
					if (
						message.type === 'eth_subscription' &&
						message.data &&
						typeof message.data === 'object' &&
						'subscription' in message.data
					) {
						if (subscriptionId === message.data.subscription) {
							checkLatestBlock();
						}
					}
				});
			} catch (err) {
				console.error(`could not listen for message`, err);
			}
		} catch (err) {
			// console.error(`could not subscribe to "newHeads" messages`);
		}
	}

	function onTimeout(err: string) {
		set({
			error: {
				message:
					'Request to your wallet are timing out. Please make sure you are connected to a node / RPC and that it is now down.',
			},
		});
	}

	const observers = config.observers
		? multiObersvers([config.observers, observersForPendingActions])
		: observersForPendingActions;

	let single_provider: Web3ConnectionProvider | undefined;
	function createProvider(
		ethereum: EIP1193ProviderWithBlocknumberSubscription,
	): Web3ConnectionProvider {
		let old_provider: EIP1193ProviderWithBlocknumberSubscription | undefined;
		if (!single_provider) {
			single_provider = wrapProvider(
				ethereum,
				observers,
				config.provider,
				emitNewBlockIfNotAlreadyEmitted,
				onTimeout,
			);
		} else {
			old_provider = single_provider.underlyingProvider;
			single_provider.setUnderlyingProvider(ethereum);
		}
		handleNewHeads(ethereum, old_provider);
		return single_provider;
	}

	// ----------------------------------------------------------------------------------------------

	// TODO but at a lower leve, wrap is doing too much currently
	// // ----------------------------------------------------------------------------------------------
	// // attempt to wrap window.ethereum so all request are captured, no matter how you want to handle it
	// // ----------------------------------------------------------------------------------------------
	// try {
	// 	if (globalThis.window.ethereum) {
	// 		// try to wrap the ethereum object if possible
	// 		createProvider(globalThis.window.ethereum);
	// 	}
	// } catch (err) {
	// 	logger.info(err);
	// }
	// // ----------------------------------------------------------------------------------------------

	function hasChainChanged(chainId: string): boolean {
		return chainId !== $network.chainId;
	}

	async function onChainChanged(chainId: string) {
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
					setAccount({ state: 'Disconnected', isLoadingData: 'Loading Network...' });
				}
				await handleNetwork(chainIdAsDecimal);
				if (needToLoadAccountData) {
					setAccount({ state: 'Disconnected', isLoadingData: 'Loading account...' });
				}
				await handleAccount($account.address, chainIdAsDecimal);
			} catch (err) {
				if (needToLoadAccountData) {
					setAccount({
						state: 'Disconnected',
						isLoadingData: undefined,
						loadingStep: undefined,
						error: { message: `failed to handle network/account change`, cause: err },
					}); // TODO any
					_connect.resolve(['connection+account', 'connection+network+account'], false);
				}
				console.error(`failed to handle network and account`, err);
			}
		}
	}

	async function updateContractsInfos(newNetworkConfig: NetworkConfigs<ContractsInfos>) {
		config.networks = newNetworkConfig;
		if ($network.chainId) {
			handleNetwork($network.chainId);
		}
	}

	async function handleNetwork(chainId: string) {
		try {
			if (!single_provider) {
				throw new Error(`no provider setup`);
			}
			if (config.devNetwork?.checkCacheIssues && config.devNetwork.chainId === chainId) {
				logger.info(`checking genesis...`);
				const genesis = await checkGenesis(single_provider, config.devNetwork.url);
				const blockHeight = await checkBlockHeight(single_provider, config.devNetwork.url);
				let hasEncounteredBlocksCacheIssue = hasPreviouslyEncounteredBlocksCacheIssue(chainId);
				if (!genesis.matching || !blockHeight.matching) {
					recordBlockCacheIssue(chainId);
					hasEncounteredBlocksCacheIssue = true;
				}
				setNetwork({
					genesisNotMatching: !genesis.matching,
					genesisHash: genesis.hash,
					blocksCached: !blockHeight.matching,
					hasEncounteredBlocksCacheIssue,
				});
				if (!genesis.matching || !blockHeight.matching) {
					listenForBlocksCacheCleared(chainId, true);
				}
			} else {
				setNetwork({
					genesisNotMatching: undefined,
					genesisHash: undefined,
					blocksCached: undefined,
				});
			}
			if (!config.networks) {
				setNetwork({
					state: 'Connected',
					chainId,
					notSupported: false,
					contracts: {} as ContractsInfos,
					chainInfo: {} as ChainInfo,
				});
			} else {
				let networkConfigs = config.networks;
				if (typeof networkConfigs === 'function') {
					setNetwork({
						chainId,
						loading: true,
					});
					// TODO check multiple networks ?
					networkConfigs = (await networkConfigs(chainId)) as NetworkConfigs<ContractsInfos>;
				}

				// TODO cache
				const singleNetworkConfig = getSingleNetworkConfig(networkConfigs, chainId);
				if (singleNetworkConfig) {
					setNetwork({
						state: 'Connected',
						chainId,
						loading: false,
						notSupported: false,
						contracts: singleNetworkConfig.contracts as ContractsInfos,
						chainInfo: singleNetworkConfig.chainInfo,
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
					if ($state.walletType && $state.requirements === 'connection+network+account') {
						recordSelection($state.walletType.type);
					}
					_connect.resolve('connection+network+account', true);
				} else {
					if ($state.walletType && $state.requirements === 'connection+account') {
						recordSelection($state.walletType.type);
					}
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
				logger.error(`pollAccountsChanged: no provider anymore, but we are still listening !!!???`);
			}
			let accounts: `0x${string}`[] = [];
			try {
				accounts = await $state.provider.request({ method: 'eth_accounts' });
			} catch (err) {
				logger.error(`failed to fetch accounts`, err);
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

	async function pollChainChanged(callback: (chainId: `0x${string}`) => void) {
		while ($state.provider) {
			await wait(3000); // TODO config
			if (!listening) {
				break;
			}

			if (!$state.provider) {
				logger.error(`pollChainChanged: no provider anymore, but we are still listening !!!???`);
			}
			let chainId: `0x${string}` | undefined;
			try {
				chainId = await $state.provider.request({ method: 'eth_chainId' });
			} catch (err) {
				logger.error(`failed to get chainId`, err);
			}

			if (chainId) {
				const chainIdAsDecimal = formatChainId(chainId);
				// logger.debug({ accounts }); // TODO remove
				if (hasChainChanged(chainIdAsDecimal)) {
					try {
						callback(chainId);
					} catch (e) {
						logger.error(e);
						// TODO error in $connection.error ?
					}
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
			logger.info('LISTENNING');
			try {
				$state.provider.on('chainChanged', onChainChanged);
				$state.provider.on('accountsChanged', onAccountsChanged);
			} catch (err) {
				// console.error(`cannot add listeners`, err);
			}

			listening = true;

			// still poll as accountsChanged does not seem to be triggered all the time
			// this issue was tested in Metamask back in web3w, // TOCHECK
			// in Brave this issue happen for lock when invoked first time, see : https://github.com/brave/brave-browser/issues/28688
			pollAccountsChanged(onAccountsChanged);
			// still poll as chainChanged does not seem to be triggered all the time
			// this issue was tested in Metamask back in web3w, // TOCHECK
			// in Brave this issue happen for lock when invoked first time, see : https://github.com/brave/brave-browser/issues/28688
			pollChainChanged(onChainChanged);
		}
	}

	function stopListeningForChanges() {
		if ($state.provider && listening) {
			logger.info('STOP LISTENNING');
			try {
				$state.provider.removeListener('chainChanged', onChainChanged);
				$state.provider.removeListener('accountsChanged', onAccountsChanged);
			} catch (err) {
				// console.error(`cannot remove listeners`, err);
			}

			listening = false;
		}
	}

	async function listenForNonceCacheCleared(chainId: string, skipFirst?: boolean) {
		let nonceCached = $network.nonceCached;
		while (nonceCached) {
			if ($network.chainId == chainId) {
				if (skipFirst) {
					skipFirst = false;
				} else {
					if (!$state.provider) {
						logger.error(
							`pollChainChanged: no provider anymore, but we are still listening !!!???`,
						);
					}
					if ($account.address && single_provider && config.devNetwork?.checkCacheIssues) {
						nonceCached = await isNonceCached(
							$account.address,
							single_provider,
							config.devNetwork.url,
						);
						if (!nonceCached) {
							setNetwork({ nonceCached });
						}
					}
				}
			}

			await wait(1000); // TODO config
		}
	}

	async function listenForBlocksCacheCleared(chainId: string, skipFirst?: boolean) {
		let genesisNotMatching = $network.genesisNotMatching;
		let blocksCached = $network.blocksCached;
		while (genesisNotMatching || blocksCached) {
			if ($network.chainId == chainId) {
				if (skipFirst) {
					skipFirst = false;
				} else {
					if (!$state.provider) {
						logger.error(
							`pollChainChanged: no provider anymore, but we are still listening !!!???`,
						);
					}
					if (single_provider && config.devNetwork?.checkCacheIssues) {
						const genesisStatus = await checkGenesis(single_provider, config.devNetwork.url);
						genesisNotMatching = !genesisStatus.matching;
						const blockHeight = await checkBlockHeight(single_provider, config.devNetwork.url);
						blocksCached = !blockHeight.matching;
						if (
							$network.genesisNotMatching === genesisStatus.matching ||
							$network.blocksCached === blockHeight.matching
						) {
							setNetwork({
								genesisNotMatching: !genesisStatus.matching,
								blocksCached: !blockHeight.matching,
							});
						}
					}
				}
			} else {
				break; // we can leave here, we ll be back once the chainId is back
			}

			await wait(1000); // TODO config
		}
	}

	async function fetchAndSetChainId() {
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
			let chainId: string | undefined;
			if ($state.provider) {
				chainId = await timeoutRequest<EIP1193ChainId>(
					$state.provider,
					{ method: 'eth_chainId' },
					defaultParams.timeout,
				);
			}
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
				return chainId;
			} else {
				throw new Error(`no chainId returned`);
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
			set({
				error: { message: 'Could not fetch chainId', cause: err },
			});
			throw err;
		}
	}

	async function select(type: string, config?: { moduleConfig?: any; autoUnlock: boolean }) {
		const { moduleConfig, autoUnlock: autoUnlockFromConfig } = config || { autoUnlock: true };
		const autoUnlock = autoUnlockFromConfig === undefined ? true : autoUnlockFromConfig;

		try {
			if ($state.state === 'Connected') {
				// disconnect first
				logger.info(`disconnecting for select...`);
				await disconnect(false);
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
				return set({
					state: 'Disconnected',
					connecting: false,
					requireSelection: false,
					loadingModule: false,
					walletType: $state.walletType,
					provider: $state.provider,
					error: {
						title: 'No Builtin Wallet',
						message: `No builtin wallet found.`,
						id: 'NoBuiltinWallet',
					},
				});
			} // TODO other type: check if module registered

			set({
				connecting: true,
			});
			if (typeOrModule === 'builtin') {
				logger.info(`probing window.ethereum...`);
				const builtinProvider = await builtin.probe();
				if (!builtinProvider) {
					return set({
						state: 'Disconnected',
						connecting: false,
						requireSelection: false,
						loadingModule: false,
						walletType: $state.walletType,
						provider: $state.provider,
						error: {
							title: 'No Builtin Wallet',
							message: `No builtin wallet found.`,
							id: 'NoBuiltinWallet',
						},
					});
				}
				logger.info(`window.ethereum found, setting up provider...`);
				set({
					requireSelection: false,
					walletType: { type, name: walletName(type) },
					provider: createProvider(builtinProvider),
				});

				currentModule = undefined;
			} else if (typeof typeOrModule === 'string' && typeOrModule.startsWith('builtin:')) {
				if (builtin.$state.state !== 'Ready') {
					await builtin.probe();
				}
				await wait(1);
				const splitted = typeof typeOrModule === 'string' && typeOrModule.split(':');
				const name = splitted && splitted[1];
				const wallet = builtin.$state.walletsAnnounced.find((v) => v.info?.name === name);
				if (!wallet) {
					logger.error(`could not find wallet ${typeOrModule}`);
					return set({
						state: 'Disconnected',
						connecting: false,
						requireSelection: false,
						loadingModule: false,
						walletType: $state.walletType,
						provider: $state.provider,
						error: {
							title: 'No Builtin Wallet',
							message: `No builtin wallet found.`,
							id: 'NoBuiltinWallet',
						},
					});
				}
				logger.info(`${typeOrModule} found, setting up provider...`);
				set({
					requireSelection: false,
					walletType: { type, name: wallet.info?.name || typeOrModule },
					provider: createProvider(wallet.provider),
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
					return set({
						state: 'Disconnected',
						connecting: false,
						requireSelection: false,
						loadingModule: false,
						walletType: $state.walletType,
						provider: $state.provider,
						error: {
							title: 'No Module Found',
							message: `No Module found: ${type}`,
							id: 'NoModuleFound',
						},
					});
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

					logger.info(`setting up module`);
					const moduleSetup = await module.setup(moduleConfig); // TODO pass config in select to choose network

					set({
						loadingModule: false,
					});

					currentModule = module;
					set({
						requireSelection: false,
						walletType: { type, name: walletName(type) },
						provider: createProvider(
							(moduleSetup as any).eip1193Provider || (moduleSetup as any).web3Provider,
						),
					});
					await handleNetwork(moduleSetup.chainId);
					logger.info(`module setup`);
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
					error: { message }, // TODO code
				});
				return set({
					state: 'Disconnected',
					connecting: false,
					requireSelection: false,
					loadingModule: false,
					walletType: $state.walletType,
					provider: $state.provider,
					error: {
						title: 'No Wallet Found',
						message,
						id: 'NoWalletFound',
					},
				});
			}

			if ($network.state !== 'Connected') {
				// TODO better naming/flow ?
				try {
					logger.info(`getting chainId...`);
					try {
						await fetchAndSetChainId();
					} catch {
						// we fallback on fetching account
						logger.info(`falling back on requesting access...`);
						await timeoutRequest(
							$state.provider,
							{ method: 'eth_requestAccounts' },
							defaultParams.timeout,
						);
						logger.info(`fetching chainId again...`);
						await fetchAndSetChainId();
					}
				} catch (err) {
					logger.log(`could not fetch chainId, even after asking to request accounts`);

					const error = {
						message: `Could not connect to your wallet. Verify your node or remote RPC is not down.`,
						cause: err,
					};
					// cannot fetch chainId, this means we are not connected

					// TODO? this need to be everywhere where we throw : _connect.reject('*', err);  no ?
					_connect.reject('*', error);

					return set({
						state: 'Disconnected',
						connecting: false,
						requireSelection: false,
						loadingModule: false,
						walletType: $state.walletType,
						provider: $state.provider,
						error,
					});
				}

				// this allow typoescript to stay silent about $network.chainId being possibly undefined
				if (!$network.chainId) {
					_connect.reject('*', 'chainId not set');
					throw new Error(`chainId not set, should be impossible`);
				}
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
			if ($state.walletType && $state.requirements === 'connection') {
				recordSelection($state.walletType.type);
			}
			_connect.resolve('connection', true);

			if ($network.chainId) {
				try {
					await handleNetwork($network.chainId);
					await fetchAccount($state.provider, autoUnlock);
				} catch (err) {
					console.error(err);
				}
			} else {
				set({
					state: 'Disconnected',
					connecting: false,
					requireSelection: false,
					loadingModule: false,
					walletType: $state.walletType,
					provider: $state.provider,
					error: { message: `no chainId set` },
				});
				return;
			}
		} catch (err) {
			logger.info(`select error`, err);
			set({
				state: 'Disconnected',
				connecting: false,
				requireSelection: false,
				loadingModule: false,
				walletType: $state.walletType,
				provider: $state.provider,
				error: { message: `failed to select wallet ${type ? `of type ${type}` : ''}`, cause: err },
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
		// let counter = ++accountUpdateCounter;
		if (address) {
			let chainIdToCheck = newChainId || $network.chainId;
			if (!single_provider) {
				throw new Error(`no provider`);
			}
			if (!chainIdToCheck) {
				const chainIdHex = await single_provider.request({ method: 'eth_chainId' });
				chainIdToCheck = Number(chainIdHex).toString();
			}
			if (config.devNetwork?.checkCacheIssues && config.devNetwork.chainId === chainIdToCheck) {
				logger.info(`checking nonce...`);
				const nonceCached = await isNonceCached(address, single_provider, config.devNetwork.url);
				if (nonceCached) {
					console.error(`nonce not matching, your provider is caching wrong info`);
				}
				if (nonceCached === 'BlockOutOfRangeError') {
					recordBlockCacheIssue(chainIdToCheck);
					setNetwork({ hasEncounteredBlocksCacheIssue: true });
				}
				setNetwork({ nonceCached });
				listenForNonceCacheCleared(chainIdToCheck, true);
			}

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
									isLoadingData: `Unloading... for ( ${address})`,
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

								setAccount({ isLoadingData: `Loading... ${address}` });
							} else {
								accountDataLoaded = address;
								setAccount({
									isLoadingData: `Loading... ${address}`,
									address,
									locked: false,
									unlocking: false,
								});
							}
							try {
								// console.log(`BEFORE LOAD`, JSON.stringify($account, null, 2));
								await config.acccountData.loadWithNetworkConnected(
									{
										address,
										connection: $state as ConnectedState,
										network: $network as
											| DisconectedBecauseNotSupportedNetworkState
											| ConnectedNetworkState<ContractsInfos>,
									},
									(msg: string) => {
										setAccount({ isLoadingData: msg || $account.isLoadingData });
									},
									(id?: string, data?: any) => {
										setAccount({ loadingStep: { id: id || 'WaitingForConfirmation', data } });
										return _accountLoadingStep
											.promise()
											.catch(() => {
												recordSelection('');
											})
											.finally(() => {
												setAccount({ loadingStep: undefined });
											});
									},
								);

								if (loadCounterUsed != loadCounter) {
									console.log(`change of address or network, stop right there`);
									return;
								}

								// if (counter < accountUpdateCounter) {
								// 	return;
								// }
								setAccount({
									isLoadingData: undefined,
									loadingStep: undefined,
								});

								if (!$account.locked && $account.address) {
									setAccount({
										state: 'Connected',
									});
									if ($network.state === 'Connected') {
										if ($state.walletType && $state.requirements === 'connection+network+account') {
											recordSelection($state.walletType.type);
										}
										_connect.resolve('connection+network+account', true);
									} else {
										if ($state.walletType && $state.requirements === 'connection+account') {
											recordSelection($state.walletType.type);
										}
										_connect.resolve('connection+account', true);
									}
								} else {
									console.log(`CHANGE`, JSON.stringify($account, null, 2));
								}
							} catch (err) {
								if (loadCounterUsed != loadCounter) {
									console.log(
										`change of address or network, stop right there, ignore loading error`,
									);
									return;
								}
								console.error(`ERROR`, err);
								accountDataLoaded = undefined;
								setAccount({
									state: 'Disconnected',
									// locked: false,
									isLoadingData: undefined,
									loadingStep: undefined,
									error: { message: `failed to load account ${address}`, cause: err },
								});
								// not sure if we should resolve to false here,
								// TODO let user retry load account
								// _connect.resolve(['connection+account', 'connection+network+account'], false);
							}
						} else {
							if ($account.state !== 'Connected') {
								setAccount({
									state: 'Connected',
									address,
									locked: false,
									unlocking: false,
								});
								if (!$account.isLoadingData) {
									if ($network.state === 'Connected') {
										if ($state.walletType && $state.requirements === 'connection+network+account') {
											recordSelection($state.walletType.type);
										}
										_connect.resolve('connection+network+account', true);
									} else {
										if ($state.walletType && $state.requirements === 'connection+account') {
											recordSelection($state.walletType.type);
										}
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
							isLoadingData: 'Waiting for Network...',
						});
						// do not resolve to false here
						// _connect.resolve(['connection+account', 'connection+network+account'], false);
					}
				} catch (err) {
					setAccount({
						state: 'Disconnected',
						locked: false,
						unlocking: false,
						address,
						isLoadingData: undefined,
						loadingStep: undefined,
						error: { message: `failed to handle account (${address})`, cause: err },
					});
					// do not resolve to false here
					// _connect.resolve(['connection+account', 'connection+network+account'], false);
				}
			} else {
				setAccount({ state: 'Connected', locked: false, address, unlocking: false });
				if ($network.state === 'Connected') {
					if ($state.walletType && $state.requirements === 'connection+network+account') {
						recordSelection($state.walletType.type);
					}
					_connect.resolve('connection+network+account', true);
				} else {
					if ($state.walletType && $state.requirements === 'connection+account') {
						recordSelection($state.walletType.type);
					}
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

			if (config.acccountData) {
				accountDataLoaded = undefined;
				try {
					loadCounterUsed = ++loadCounter;
					await config.acccountData.unload();
				} catch (err) {}
			}

			// TODO if network was read-only ?
			// await disconnect(false);
			// // TODO  'connection+account' option
			// await connect('connection+network+account');
		}
	}

	async function fetchAccount(provider: EIP1193Provider, autoUnlock: boolean) {
		let accounts: `0x${string}`[];
		try {
			try {
				logger.info(`fetching accounts...`);
				setAccount({
					fetching: true,
				});
				const networkParams: Parameters = {
					defaultParams,
					...($network.chainId ? parameters[$network.chainId] : parameters.default),
				} as any;
				const timeout = networkParams.timeout;
				accounts = await timeoutRequest(provider, { method: 'eth_accounts' }, timeout);
				setAccount({
					fetching: false,
				});
			} catch (err) {
				setAccount({
					fetching: false,
				});
				const errWithCode = err as { code: number; message: string };
				if (errWithCode.code === 4100) {
					logger.info(`4100 ${errWithCode.message || (errWithCode as any).name}`); // TOCHECK why name here ?
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
			logger.info(`accounts: ${accounts}`);
			// }
		} catch (err) {
			set({
				error: { message: 'Error while fetching accounts, Check your wallet.', cause: err }, // TODO remove $account.error and $network.error ?
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

	async function disconnect(resolve = true): Promise<void> {
		recordSelection('');
		stopListeningForChanges();
		setAccount({ state: 'Disconnected', locked: false, unlocking: false, address: undefined });
		if (config.acccountData) {
			accountDataLoaded = undefined;
			try {
				await config.acccountData.unload();
			} catch (err) {}
		}
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

		if (resolve) {
			_connect.resolve('*', false);
		}
		if (moduleToDisconnect) {
			await moduleToDisconnect.disconnect();
		}
	}

	const _connect = createManageablePromiseWithId<boolean>();

	const _accountLoadingStep = createManageablePromise();

	function connect(
		requirements: ConnectionRequirements = 'connection+network+account',
	): Promise<boolean> {
		async function fromDisconnected(type?: string) {
			set({
				connecting: true,
				requirements,
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

		async function attempt() {
			let type: string | undefined = undefined;
			if (optionsAsStringArray.length === 0) {
				type = 'builtin';
			} else if (optionsAsStringArray.length === 1) {
				type = optionsAsStringArray[0];
			}

			if (type === 'builtin') {
				await builtin.probe();
				if (
					(!builtin.$state.ethereumAnnounced && builtin.$state.walletsAnnounced.length > 0) ||
					(builtin.$state.ethereumAnnounced && builtin.$state.walletsAnnounced.length > 1)
				) {
					type = undefined;
				}
			}

			if ($state.state === 'Connected') {
				if ($network.state === 'Connected') {
					if (requirements === 'connection+network+account') {
						if ($account.state !== 'Connected') {
							if ($state.walletType.type === 'ReadOnly' || !fetchPreviousSelection()) {
								await disconnect(false);
								await fromDisconnected(type);
							} else {
								if ($account.locked) {
									await unlock();
								} else {
									handleAccount($account.address);
								}
							}
						}
					} else {
					}
				} else {
					// TODO? connection+account ?
					if (requirements === 'connection') {
						recordSelection($state.walletType.type);
						return _connect.resolve('connection', true);
					}
					if ($network.chainId) {
						await handleNetwork($network.chainId);
					} else {
						await fetchAndSetChainId();
						await handleNetwork($network.chainId as string); // should be good
					}
					if ($account.state !== 'Connected') {
						if ($account.locked) {
							await unlock();
						} else {
							if ($account.address) {
								handleAccount($account.address);
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
						}
					}
				}
			} else {
				await fromDisconnected(type);
			}
		}
		if (_connect.exists(requirements)) {
			attempt();
		}
		return _connect.promise(requirements, async (resolve, reject) => {
			attempt();
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
								'Already processing eth_requestAccounts. Please wait.',
							) ||
								errWithCode.message.includes(
									`Request of type 'wallet_requestPermissions' already pending`,
								))
						) {
							set({
								// TODO auto-aknowledge error like this when they can be resolved by chnage of state
								// in that case, if the wallet get unlocked, then this message should disapear
								// IMPLEMENATION IDEAS :
								//  Use a internal error type here: "unlocking-error"
								// then add a utility function resolveError that can be called by unlock:
								// autoResolveError("unlocking-error");
								error: {
									message: `To unlock your wallet, please click on the Metamask add-on's icon and unlock from there.`,
								},
							});
							// we ignore the error
							// we should not resolve
							// _connect.resolve(['connection+account', 'connection+network+account'], false);
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
								},
							});
							// we ignore the error
							// we should not resolve
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
		callback: ConnectAndExecuteCallback<T>,
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

	async function execute<T, TAddress extends Address>(
		callback: ExecuteCallback<ContractsInfos, TAddress, T>,
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
				account: $account as ConnectedAccountState<TAddress>,
				network: $network as ConnectedNetworkState<ContractsInfos>,
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
							account: $account as ConnectedAccountState<TAddress>,
							network: $network as ConnectedNetworkState<ContractsInfos>,
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
			// what about other connect ?
			_connect.resolve('*', false);
		}
	}

	async function switchTo(
		chainId: string,
		config?: {
			readonly rpcUrls?: readonly string[];
			readonly blockExplorerUrls?: readonly string[];
			readonly chainName?: string;
			readonly iconUrls?: readonly string[];
			readonly nativeCurrency?: {
				name: string;
				symbol: string;
				decimals: number;
			};
		},
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
				logger.info(`wallet_switchEthereumChain: complete`);
				// this will be taken care with `chainChanged` (but maybe it should be done there ?)
				// handleNetwork(chainId);
			} else {
				logger.info(`wallet_switchEthereumChain: a non-undefinded result means an error`, result);
				throw result;
			}
		} catch (err) {
			if ((err as any).code === 4001) {
				logger.info(
					`wallet_addEthereumChain: failed but error code === 4001, we ignore as user rejected it`,
					err,
				);
				return;
			}
			// if ((err as any).code === 4902) {
			else if (config && config.rpcUrls && config.rpcUrls.length > 0) {
				logger.info(
					`wallet_switchEthereumChain: could not switch, try adding the chain via "wallet_addEthereumChain"`,
				);
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
						// this will be taken care with `chainChanged` (but maybe it should be done there ?)
						// handleNetwork(chainId);
					} else {
						logger.info(`wallet_addEthereumChain: a non-undefinded result means an error`, result);
						throw result;
					}
				} catch (err) {
					if ((err as any).code !== 4001) {
						logger.info(`wallet_addEthereumChain: failed`, err);
						set({
							error: { message: `Failed to add new chain`, cause: err },
						});
					} else {
						logger.info(
							`wallet_addEthereumChain: failed but error code === 4001, we ignore as user rejected it`,
							err,
						);
						return;
					}
				}
			} else {
				logger.info(`cannot call wallet_addEthereumChain as we do not have network details`);
				set({
					error: {
						message: `Chain "${
							config?.chainName || `with chainId = ${chainId}`
						} " is not available on your wallet.`,
					},
				});
			}
			// } else {
			// 	logger.info(`wallet_switchEthereumChain: failed !== 4902`, err);
			// 	if ((err as any).code !== 4001) {
			// 		logger.info(`wallet_switchEthereumChain: failed !== 4001`, err);
			// 		set({
			// 			error: err as any, // TODO
			// 		});
			// 	} else {
			// 		logger.info(
			// 			`wallet_switchEthereumChain: failed but error code === 4001, we ignore as user rejected it`,
			// 			err
			// 		);
			// 		return;
			// 	}
			// }
		}
	}

	async function autoStart(fallback: () => Promise<void>) {
		let timeout: Timeout | undefined;
		try {
			const delay = 2;
			timeout = setTimeout(async () => {
				logger.info(`attempt to reuse previous wallet timed out after ${delay} seconds.`);
				await disconnect();
				// set({
				// 	initialised: true,
				// 	error: {
				// 		code: 7221,
				// 		message: 'Your wallet seems to not respond, please reload.',
				// 	},
				// });
				await fallback();
			}, delay * 1000);
			const type = fetchPreviousSelection();
			if (type && type !== '') {
				try {
					await select(type, { autoUnlock: false });
				} catch {
				} finally {
					clearTimeout(timeout);
					set({ initialised: true });
				}
			} else {
				clearTimeout(timeout);
				fallback();
			}
		} catch {
			clearTimeout(timeout);
			await fallback();
		}
	}

	if (config.defaultRPC) {
		logger.info(`Setting rpc provider ${config.defaultRPC}`);
		const httpProvider = createRPCProvider(config.defaultRPC);
		set({ httpProvider });
	}

	async function start() {
		if (config.defaultRPC && $state.httpProvider) {
			logger.info(`using defaultRPC provider ${config.defaultRPC}`);
			set({
				state: 'Connected',
				connecting: false,
				requireSelection: false,
				walletType: { type: 'ReadOnly', name: config.defaultRPC.url },
				provider: createProvider($state.httpProvider as EIP1193Provider),
				initialised: true,
			});
			await handleNetwork(config.defaultRPC.chainId);
		} else {
			set({
				initialised: true,
			} as any); // TODO ensure we can set initilaized alone
		}
	}

	if (typeof window !== 'undefined') {
		if (config.autoConnectUsingPrevious) {
			autoStart(start);
		} else {
			start();
		}
	}

	let devProvider: EIP1193Provider | undefined;
	if (config.devNetwork) {
		devProvider = createRPCProvider(config.devNetwork);
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
			onNewBlock,
			offNewBlock,
		},
		network: {
			...readableNetwork,
			switchTo,
			async acknowledgeBlockCacheIssue() {
				if ($network.chainId) {
					acknowledgeBlockCacheIssue($network.chainId);
					setNetwork({
						hasEncounteredBlocksCacheIssue: false,
					});
				} else {
					throw new Error(`no chainId`);
				}
			},
			async notifyThatCacheHasBeenCleared() {
				if ($network.chainId) {
					listenForBlocksCacheCleared($network.chainId);
					listenForNonceCacheCleared($network.chainId);
				} else {
					throw new Error(`no chainId connected, cannot check for nonce or genesis cache issue`);
				}
			},
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
		devProvider,
		pendingActions,
		execution: {
			...readableExecution,
			cancel: cancelExecution,
		},
		execute,
	};
}

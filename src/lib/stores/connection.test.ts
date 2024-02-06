import { describe, it, expect } from 'vitest';
import { init } from './connection';
import { LOCAL_STORAGE_PREVIOUS_WALLET_SLOT } from './localStorage';
import { waitFor } from '../../utils';
import { fakeRPCProvider, initUser } from '../../utils/test-provider';

describe('initialization', () => {
	it('works', async () => {
		const { connection } = await init({});
		expect(connection.$state.state).to.equal('Disconnected');
		expect(connection.$state.initialised).to.equal(true);
		expect(connection.$state.connecting).to.equal(false);
	});
	it('auto connect wtih builtin but builtin not present', async () => {
		localStorage.setItem(LOCAL_STORAGE_PREVIOUS_WALLET_SLOT, 'builtin');
		const { connection } = init({ autoConnectUsingPrevious: true });

		expect(connection.$state.state).to.equal('Disconnected');
		expect(connection.$state.initialised).to.equal(false);
		expect(connection.$state.connecting).to.equal(true);

		await waitFor(connection, { initialised: true });
		expect(connection.$state.error).toBeTruthy();
		expect(connection.$state.connecting).to.equal(false);
		expect(connection.$state.initialised).to.equal(true);
	});

	it('auto connect wtih builtin but builtin not implemented', async () => {
		window.ethereum = {};
		localStorage.setItem(LOCAL_STORAGE_PREVIOUS_WALLET_SLOT, 'builtin');
		const { connection } = init({ autoConnectUsingPrevious: true });

		expect(connection.$state.state).to.equal('Disconnected');
		expect(connection.$state.initialised).to.equal(false);
		expect(connection.$state.connecting).to.equal(true);

		await waitFor(connection, { initialised: true });
		expect(connection.$state.error).toBeTruthy();
		expect(connection.$state.connecting).to.equal(false);
		expect(connection.$state.initialised).to.equal(true);
	});

	it('auto connect with builtin', async () => {
		const user = initUser();
		user.installBuiltinProvider();

		localStorage.setItem(LOCAL_STORAGE_PREVIOUS_WALLET_SLOT, 'builtin');
		const { connection, account, network } = init({ autoConnectUsingPrevious: true });

		expect(connection.$state.state).to.equal('Disconnected');
		expect(connection.$state.initialised).to.equal(false);
		expect(connection.$state.connecting).to.equal(true);

		await waitFor(connection, { initialised: true });
		expect(connection.$state.state).to.equal('Connected');
		expect(connection.$state.error).toBeUndefined();
		expect(connection.$state.connecting).to.equal(false);
		expect(connection.$state.initialised).to.equal(true);

		expect(network.$state.state).to.equal('Connected');
		expect(account.$state.state).to.equal('Disconnected');
		expect(account.$state.address).toBeUndefined();
	});

	it('auto connect with builtin and  account unlocked', async () => {
		const userAddress = '0x1111111111111111111111111111111111111112';
		const user = initUser();
		user.installBuiltinProvider();

		user.connectAccount(userAddress);

		localStorage.setItem(LOCAL_STORAGE_PREVIOUS_WALLET_SLOT, 'builtin');
		const { connection, account, network } = init({ autoConnectUsingPrevious: true });

		expect(connection.$state.state).to.equal('Disconnected');
		expect(connection.$state.initialised).to.equal(false);
		expect(connection.$state.connecting).to.equal(true);

		await waitFor(connection, { initialised: true });
		expect(connection.$state.state).to.equal('Connected');
		expect(connection.$state.error).toBeUndefined();
		expect(connection.$state.connecting).to.equal(false);
		expect(connection.$state.initialised).to.equal(true);

		expect(network.$state.state).to.equal('Connected');
		expect(account.$state.state).to.equal('Connected');
		expect(account.$state.address).to.equal(userAddress);
	});

	it('auto connect with builtin and  account locked', async () => {
		const userAddress = '0x1111111111111111111111111111111111111112';
		const user = initUser();
		user.installBuiltinProvider();

		user.connectAccount(userAddress);
		user.lock();

		localStorage.setItem(LOCAL_STORAGE_PREVIOUS_WALLET_SLOT, 'builtin');
		const { connection, account, network } = init({ autoConnectUsingPrevious: true });

		expect(connection.$state.state).to.equal('Disconnected');
		expect(connection.$state.initialised).to.equal(false);
		expect(connection.$state.connecting).to.equal(true);

		await waitFor(connection, { initialised: true });
		expect(connection.$state.state).to.equal('Connected');
		expect(connection.$state.error).toBeUndefined();
		expect(connection.$state.connecting).to.equal(false);
		expect(connection.$state.initialised).to.equal(true);

		expect(network.$state.state).to.equal('Connected');
		expect(account.$state.state).to.equal('Disconnected');
		expect(account.$state.address).toBeUndefined();
	});
});

describe('connection', () => {
	it('works', async () => {
		const userAddress = '0x1111111111111111111111111111111111111112';
		const user = initUser();
		user.installBuiltinProvider();

		const { connection, network, account } = await init({});
		const connectionPromise = connection.connect();

		user.connectAccount(userAddress);

		await waitFor(connection, { state: 'Connected' });
		expect(network.$state.state).to.equal('Connected');

		expect(account.$state.state).to.equal('Disconnected');
		await connectionPromise;
		expect(account.$state.address).to.equal(userAddress);
	});
});

describe('execution', () => {
	it('works', async () => {
		const userAddress = '0x1111111111111111111111111111111111111112';
		const user = initUser();
		user.installBuiltinProvider();

		const { connection, network, account, execution, execute } = await init({});

		const executionPromise = execute(async ($state) => {
			// console.log({ $state });
		});

		await waitFor(connection, { state: 'Connected' });
		expect(network.$state.state).to.equal('Connected');
		expect(account.$state.state).to.equal('Disconnected');

		user.connectAccount(userAddress);

		await executionPromise;
		expect(account.$state.address).to.equal(userAddress);
	});

	it('works locked', async () => {
		const userAddress = '0x1111111111111111111111111111111111111112';
		const user = initUser();
		user.installBuiltinProvider();

		const { connection, network, account, execution, execute } = await init({});
		user.connectAccount(userAddress);
		user.lock();
		const executionPromise = execute(async ($state) => {
			// console.log({ $state });
		});

		await waitFor(connection, { state: 'Connected' });
		expect(network.$state.state).to.equal('Connected');

		await waitFor(account, { locked: true });

		expect(account.$state.state).to.equal('Disconnected');

		user.unlock();

		await waitFor(account, { state: 'Connected' });
		await executionPromise;
	});
});

describe('execution on network', () => {
	it('works', async () => {
		const userAddress = '0x1111111111111111111111111111111111111112';
		const user = initUser();
		user.installBuiltinProvider();

		const { connection, network, account, execution, execute } = await init({
			networks: {
				chainId: '12',
				contracts: {
					Test: {
						abi: [],
						address: '0xFF1111111111111111111111111111111111112',
					},
				},
			},
		});

		const executionPromise = execute(async ($state) => {
			// console.log({ $state });
		});
		expect(execution.$state.executing).toEqual(true);

		await waitFor(connection, { state: 'Connected' });
		expect(network.$state.state).to.equal('Disconnected');
		expect(account.$state.state).to.equal('Disconnected');

		user.connectAccount(userAddress);
		await waitFor(account, { state: 'Connected' });
		expect(execution.$state.executing).toEqual(true);

		// network.switchTo('12');
		user.switchChain('12');
		await waitFor(network, { state: 'Connected' });

		expect(execution.$state.executing).toEqual(true);

		await executionPromise;
		expect(account.$state.address).to.equal(userAddress);
		expect(execution.$state.executing).toEqual(false);
	});

	it('works even when started with defaultRPC', async () => {
		const userAddress = '0x1111111111111111111111111111111111111112';
		const user = initUser();
		user.installBuiltinProvider();

		const fakeRPC = fakeRPCProvider('12') as any;
		const { connection, network, account, execution, execute } = await init({
			networks: {
				chainId: '12',
				contracts: {
					Test: {
						abi: [],
						address: '0xFF1111111111111111111111111111111111112',
					},
				},
			},
			defaultRPC: { chainId: '12', url: fakeRPC },
		});

		const executionPromise = execute(async ($state) => {
			// console.log({ $state });
		});
		expect(execution.$state.executing).toEqual(true);

		await waitFor(connection, { state: 'Connected' });
		expect(network.$state.state).to.equal('Disconnected');
		expect(account.$state.state).to.equal('Disconnected');

		user.connectAccount(userAddress);
		await waitFor(account, { state: 'Connected' });
		expect(execution.$state.executing).toEqual(true);

		// network.switchTo('12');
		user.switchChain('12');
		await waitFor(network, { state: 'Connected' });

		expect(execution.$state.executing).toEqual(true);

		await executionPromise;
		expect(account.$state.address).to.equal(userAddress);
		expect(execution.$state.executing).toEqual(false);
	});

	it('works locked', async () => {
		const userAddress = '0x1111111111111111111111111111111111111112';
		const user = initUser();
		user.installBuiltinProvider();

		const { connection, network, account, execution, execute } = await init({
			networks: {
				chainId: '12',
				contracts: {
					Test: {
						abi: [],
						address: '0xFF1111111111111111111111111111111111112',
					},
				},
			},
		});

		user.connectAccount(userAddress);
		user.lock();
		const executionPromise = execute(async ($state) => {
			// console.log({ $state });
		});

		expect(execution.$state.executing).toEqual(true);

		await waitFor(connection, { state: 'Connected' });
		expect(network.$state.state).to.equal('Disconnected');

		expect(execution.$state.executing).toEqual(true);

		await waitFor(account, { locked: true });

		expect(account.$state.state).to.equal('Disconnected');

		expect(execution.$state.executing).toEqual(true);

		user.unlock();

		await waitFor(account, { state: 'Connected' });
		expect(execution.$state.executing).toEqual(true);

		user.switchChain('11');
		user.switchChain('12');
		await waitFor(network, { state: 'Connected' });

		expect(execution.$state.executing).toEqual(true);

		await executionPromise;
		expect(execution.$state.executing).toEqual(false);
	});
});

import { describe, it, expect } from 'vitest';
import { init, type ConnectionState } from './connection';
import { LOCAL_STORAGE_PREVIOUS_WALLET_SLOT } from './localStorage';
import { waitFor } from '../../utils';
import { initTestProvider } from '../../utils/test-provider';

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
		window.ethereum = initTestProvider();
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
		const provider = initTestProvider();
		window.ethereum = provider;
		provider.connectAccount(userAddress);
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
		const provider = initTestProvider();
		window.ethereum = provider;
		provider.connectAccount(userAddress);
		provider.lockAccount(userAddress);
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
		const provider = initTestProvider();
		window.ethereum = provider;
		const { connection, network, account } = await init({});
		provider.acceptNextRequestAccount(userAddress);
		const connectionPromise = connection.connect();

		await waitFor(connection, { state: 'Connected' });
		expect(network.$state.state).to.equal('Connected');

		expect(account.$state.state).to.equal('Disconnected');
		await waitFor(account, { state: 'Connected' });
		expect(account.$state.address).to.equal(userAddress);
	});
});

<script lang="ts">
	import { pendingActions, type connection as conn } from '../app/web3';
	export let connection: typeof conn;
	import Alert from './Alert.svelte';
	import AlertWithSlot from './AlertWithSlot.svelte';
	import Modal from './modals/Modal.svelte';
	import { modalStore } from './modals/stores';
	import { url } from './utils/url';

	const builtin = connection.builtin;

	$: builtinNeedInstalation =
		(connection.options.filter((v) => v === 'builtin').length > 0 ||
			connection.options.length === 0) &&
		!$builtin.available;

	$: options = connection.options
		.filter((v) => v !== 'builtin' || $builtin.available)
		.map((v) => {
			return {
				img: ((v) => {
					if (v === 'builtin') {
						if ($builtin.state === 'Ready') {
							if ($builtin.vendor === 'Metamask') {
								return 'images/wallets/metamask.svg';
							} else if ($builtin.vendor === 'Opera') {
								return 'images/wallets/opera.svg';
							} else if ($builtin.vendor === 'Brave') {
								return 'images/wallets/brave.svg';
							}
						}
						return 'images/wallets/web3-default.png';
					} else {
						if (v.startsWith('torus-')) {
							const verifier = v.slice(6);
							return `images/wallets/torus/${verifier}.svg`;
						}
						return `images/wallets/${v}.svg`;
					}
				})(v),
				id: v,
				name: v,
			};
		});
</script>

{#if $connection.error}
	{#if $connection.error?.code == 7221}
		<AlertWithSlot onClose={connection.acknowledgeError}>
			{#if $builtin.vendor === 'Metamask'}
				<p>
					Metamask is not responding. See <a
						class="link"
						href="https://github.com/MetaMask/metamask-extension/issues/7221"
						target="_blank"
						rel="noreferrer">github issue</a
					>. Please <a class="link" on:click={() => location.reload()} href=".">reload</a>
				</p>
			{:else}
				<p>
					Your Wallet is not responding. Please <a
						class="link"
						on:click={() => location.reload()}
						href=".">reload.</a
					>
				</p>
			{/if}
		</AlertWithSlot>
	{:else}
		<Alert data={$connection.error} onClose={connection.acknowledgeError} />
	{/if}
{/if}

{#if $connection.requireSelection}
	<Modal onResponse={() => connection.cancel()}>
		<div class="text-center">
			<p>How do you want to connect ?</p>
		</div>
		<div class="flex flex-wrap justify-center pb-3">
			{#each options as option}
				<!-- TODO handle a11y-->
				<!-- svelte-ignore a11y-click-events-have-key-events-->
				<img
					class="cursor-pointer p-2 m-2 border-2 h-12 w-12 object-contain"
					alt={`Login with ${option.name}`}
					src={url(`/${option.img}`)}
					on:click={() => connection.select(option.id)}
				/>
			{/each}
		</div>
		{#if builtinNeedInstalation}
			<div class="text-center">OR</div>
			<div class="flex justify-center">
				<a href="https://metamask.io/download.html" class="m-4 w-max-content btn btn-primary">
					<img
						class="cursor-pointer p-0 mx-2 h-10 w-10 object-contain"
						alt={`Download Metamask}`}
						src={url('/images/metamask.svg')}
					/>
					Download metamask
				</a>
			</div>
		{/if}
	</Modal>
{/if}

{#if $pendingActions.list.length > 0}
	<Modal
		onResponse={() => {
			// in case the tx is rejected while showing that confirmation modal
			// we need to close it
			// TODO have modal id to ensure we close the right one
			const unsubscribe = pendingActions.subscribe((p) => {
				if (p.list.length === 0) {
					modalStore.close();
				}
			});
			modalStore.trigger({
				response: (yes) => {
					if (yes) {
						pendingActions.skip();
					}
					unsubscribe();
					return true;
				},
				content: {
					type: 'confirm',
					message: 'Are you sure?',
				},
			});
		}}
		cancelation={{ button: true, clickOutside: false }}
	>
		{#if $pendingActions.list[0].item.metadata && $pendingActions.list[0].item.metadata.title}
			<h3 class="text-lg font-bold">{$pendingActions.list[0].item.metadata.title}</h3>
		{/if}
		<p class="py-4">
			{#if $pendingActions.list[0].item.metadata && $pendingActions.list[0].item.metadata.description}
				{$pendingActions.list[0].item.metadata.description}
			{:else}
				'Please confirm or reject the request on your wallet.'
			{/if}
		</p>
	</Modal>
{/if}

<script>
	import '../app.postcss';

	import Web3Connection from '$test/Web3Connection.svelte';
	import { connection, account, pendingActions } from '../app/web3';
	import InlineInfo from '$test/InlineInfo.svelte';
	import ImgBlockie from '$test/ethereum/ImgBlockie.svelte';
	import Modals from '$test/modals/Modals.svelte';
</script>

<Web3Connection {connection} />

<div class="navbar bg-base-100">
	<div class="navbar-start">
		<span class="normal-case text-xl">Testing</span>
	</div>
	<div class="navbar-center hidden lg:flex" />
	<div class="navbar-end">
		{#if $connection.state !== 'Connected'}
			{#if $connection.state === 'Locked'}
				{#if $connection.unlocking}
					<!-- <Alert
			data={{ message: 'if the wallet unlock screen did not popup, please refers to its menus.' }}
			bgBorderText="bg-warning border-warning-content text-warning-content"
		/> -->
					<InlineInfo
						>if the wallet unlock screen did not popup, please refers to its menus.</InlineInfo
					>
				{/if}
				<button
					class="m-1 btn btn-primary"
					disabled={$connection.unlocking}
					on:click={() => connection.unlock()}>unlock</button
				>
			{:else}
				<button
					disabled={$connection.connecting}
					class={`${$connection.initialised ? '' : '!invisible'} m-1 btn btn-primary`}
					on:click={() => connection.connect()}
					>{$connection.connecting ? 'Connecting' : 'Connect'}</button
				>
			{/if}
		{:else}
			<!-- <button class="m-2 btn btn-error" on:click={() => connection.disconnect()}>disconnect</button>
			<div class="btn btn-ghost btn-circle avatar">
				<div class="w-10 rounded-full">
					<ImgBlockie address={$account.address || ''} />
				</div>
			</div> -->
			<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
			<!-- svelte-ignore a11y-label-has-associated-control -->
			<div class="dropdown dropdown-end">
				<div class="indicator">
					{#if $pendingActions.list.length > 0}
						<span style="--tw-translate-x: 10;" class="indicator-item badge badge-secondary" />
					{/if}
					<label tabindex="0" class="btn btn-ghost btn-circle avatar">
						<div class="w-10 rounded-full">
							<ImgBlockie address={$account.address || ''} />
						</div>
					</label>
				</div>
				<ul
					tabindex="0"
					class="menu menu-compact dropdown-content mt-3 p-2 shadow bg-base-200 rounded-box w-52"
				>
					<li>
						<button class="m-1 btn btn-error" on:click={() => connection.disconnect()}
							>disconnect</button
						>
					</li>
				</ul>
			</div>
		{/if}
	</div>
</div>

<slot />

<Modals />

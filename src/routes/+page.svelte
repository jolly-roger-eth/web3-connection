<script lang="ts">
	import JsonAsTable from '$test/JSONAsTable.svelte';
	import { account, connection } from '../app/web3';
</script>

<p>
	<button
		on:click={() =>
			$connection.provider?.request({
				method: 'personal_sign',
				params: ['0xdeadbeef', $account.address || ''],
			})}
		class="m-1 btn btn-primary btn-sm rounded-box">sign</button
	>

	<button
		on:click={() =>
			$connection.provider?.request({
				method: 'eth_sendTransaction',
				params: [{ from: $account.address || '', to: $account.address || '', value: '0x01' }],
			})}
		class="m-1 btn btn-primary btn-sm rounded-box">tx</button
	>
</p>

<JsonAsTable value={$connection.toJSON()} />

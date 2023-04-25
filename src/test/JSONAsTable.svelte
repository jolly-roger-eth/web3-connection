<script lang="ts">
	export let value: { [key: string]: any };
	$: keys = Object.keys(value);
</script>

<table class="border-separate border-spacing-2 border border-primary">
	<thead>
		<tr>
			<th class="border border-primary">Field</th>
			<th class="border border-primary">Value</th>
		</tr>
	</thead>
	<tbody>
		{#each keys as key}
			<tr>
				<td class="border border-primary">{key}</td>
				<td class="border border-primary">{JSON.stringify(value[key])}</td>
			</tr>
		{/each}
	</tbody>
</table>

<script lang="ts">
	import { clickoutside } from './utils/click-outside';
	export let onClose: (() => void) | undefined = undefined;
</script>

<div
	style="pointer-events: auto; visibility: visible; opacity: 1;"
	class="modal modal-bottom sm:modal-middle cursor-pointer"
>
	<div
		use:clickoutside={{ enabled: !!onClose, callback: () => onClose && onClose() }}
		class="modal-box relative"
	>
		<slot name="title" />
		<slot />
		<div class="modal-action">
			<slot name="action" />
		</div>
	</div>
</div>

<!-- title : <h3 class="font-bold text-lg">Congratulations random Internet user!</h3>-->

<!-- slot : <p class="py-4">
  You've been selected for a chance to get one year of subscription to use Wikipedia for free!
</p> -->

<!-- action: <label for="my-modal-6" class="btn">Yay!</label>-->

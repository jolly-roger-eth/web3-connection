export function wait(ms: number): Promise<void> {
	return new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

export function waitReadyState(): Promise<void> {
	return new Promise((resolve, reject) => {
		if (typeof document !== 'undefined' && document.readyState !== 'complete') {
			let old_onreadystatechange: ((this: Document, event: Event) => any) | null =
				document.onreadystatechange;
			document.onreadystatechange = function (this: Document, event: Event) {
				if (document.readyState === 'complete') {
					resolve();
					if (old_onreadystatechange) {
						old_onreadystatechange.bind(document)(event);
					}
					document.onreadystatechange = old_onreadystatechange;
					old_onreadystatechange = null;
				} else {
					if (old_onreadystatechange) {
						old_onreadystatechange.bind(document)(event);
					}
				}
			};
		} else {
			resolve();
		}
	});
}

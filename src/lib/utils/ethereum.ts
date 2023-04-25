export function formatChainId(chainId: string): string {
	return parseInt(chainId.slice(2), 16).toString();
}

export function isHex(value: string): boolean {
	return typeof value === 'string' && value.length > 2 && value.slice(0, 2).toLowerCase() === '0x';
}

export function toHex(value: string) {
	if (isHex(value)) {
		return value;
	}
	return '0x' + parseInt(value).toString(16);
}

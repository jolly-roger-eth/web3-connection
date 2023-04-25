export const chainNames: { [chainId: string]: string } = {
	'1': 'mainnet',
	'11155111': 'sepolia',
	'1337': 'localhost chain',
	'31337': 'localhost chain',
};

export function nameForChainId(chainId: string): string {
	const name = chainNames[chainId];
	if (name) {
		return name;
	}
	return `chain with id ${chainId}`;
}

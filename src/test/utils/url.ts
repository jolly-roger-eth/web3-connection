import { base } from '$app/paths';

export function pathname(p: string) {
	let path = `${base}${p}`;
	if (!path.endsWith('/')) {
		path += '/';
	}
	return path;
}

export function url(p: string) {
	return `${base}${p}`;
}

export function isSameURL(a: string, b: string): boolean {
	return a === pathname(b);
}

export function isParentURL(a: string, b: string): boolean {
	return a.startsWith(pathname(b));
}

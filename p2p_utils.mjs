export const SERVICE_NODE_PORT = 8080;
export const VARS = {
	SERVICE_NODE_PORT: 8000,
	CONNECTION_UPGRADE_TIMEOUT: 8_000,
	ENHANCE_CONNECTION_DELAY: 10_000
	//ENHANCE_CONNECTION_DELAY: () => (Math.random() * 20_000) + 10_000
}
export const isBrowserEnv = typeof window !== 'undefined' && typeof window.document !== 'undefined';
export function shuffleArray(array) { return array.sort(() => Math.random() - 0.5); }
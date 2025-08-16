import { xxHash32 } from "./xxhash32.mjs";

export { xxHash32 };

export const SERVICE_NODE_PORT = 8080;
export const VARS = {
	SERVICE_NODE_PORT: 8000,
	CONNECTION_UPGRADE_TIMEOUT: 5_000,
	ENHANCE_CONNECTION_DELAY: 2_000, // default: 10_000 (10 seconds)
	ENHANCE_CONNECTION_RATE: .05, // default: .05 (5%)
	PUBLIC_NODE_AUTO_BAN_DELAY: { min: 10_000, max: 20_000 },
	PUBLIC_NODE_AUTO_BAN_DURATION: 60_000,
	//ENHANCE_CONNECTION_DELAY: () => (Math.random() * 20_000) + 10_000

	TARGET_NEIGHBORS: 12, // default: 12
	GOSSIP_DEFAULT_TTL: 10, // default: 3 (3 hops)
	GOSSIP_TRANSMISSION_RATE: {
		default: .5, // default: .5 (50%)
		peer_connected: (10 / 12) * .25, // we can reduce this, but lowering the map quality
		peer_disconnected: (10 / 12) * .25
	}, 
}
export const isBrowserEnv = typeof window !== 'undefined' && typeof window.document !== 'undefined';
export function shuffleArray(array) { return array.sort(() => Math.random() - 0.5); }
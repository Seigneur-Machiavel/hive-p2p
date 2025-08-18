export const NODE = {
	SERVICE_PORT: 8080,
	PUBLIC_AUTO_BAN_DELAY: { min: 10_000, max: 20_000 },
	PUBLIC_AUTO_BAN_DURATION: 60_000,

	CONNECTION_UPGRADE_TIMEOUT: 5_000,
	ENHANCE_CONNECTION_DELAY: 2_000, // default: 10_000 (10 seconds)
	ENHANCE_CONNECTION_RATE: .05, // default: .05 (5%)
	MAX_BOOTSTRAPS_IN_CONNS: 10,
	MAX_BOOTSTRAPS_OUT_CONNS: 2,
	TARGET_NEIGHBORS_COUNT: 12, // default: 12
	MAX_SHARED_NEIGHBORS_COUNT: 5
}
export const MESSAGER = {
	MAX_HOPS: 10,
	MAX_NODES: 1728,
	MAX_ROUTES: 5
}
export const GOSSIP = {
	TTL: {
		default: 10,
	},
	TRANSMISSION_RATE: {
		default: .5, // 50%
		peer_connected: (10 / 12) * .25, // we can reduce this, but lowering the map quality
		peer_disconnected: (10 / 12) * .25
	},
}
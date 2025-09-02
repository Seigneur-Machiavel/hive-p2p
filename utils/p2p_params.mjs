export const NODE = {
	SERVICE_PORT: 8080,
	PUBLIC_AUTO_BAN_DELAY: { min: 10_000, max: 30_000 },
	PUBLIC_AUTO_BAN_DURATION: 60_000,

	CONNECTION_UPGRADE_TIMEOUT: 5_000, // default: 5_000 (5 seconds)
	ENHANCE_CONNECTION_DELAY: 2_500, // default: 10_000 (10 seconds)
	ENHANCE_CONNECTION_RATE_BASIS: .618, // default: .618 (61.8%)
	MAX_BOOTSTRAPS_IN_CONNS: 10, // default: 10
	MAX_BOOTSTRAPS_OUT_CONNS: 2, // prod: 2, simulation we can set: 0
	MIN_CONNECTION_TIME_TO_DISPATCH_EVENT: 2_500,
	TARGET_NEIGHBORS_COUNT: 12, // default: 12
	MAX_SHARED_NEIGHBORS_COUNT: 5 // default: 5, strict: 2
}
export const MESSAGER = {
	MAX_HOPS: 10,
	MAX_NODES: 512, // default: 1728 (12³), light: 512 (8³)
	MAX_ROUTES: 5
}
export const GOSSIP = {
	TTL: {
		default: 10,
	},
	TRANSMISSION_RATE: {
		default: 1, // .51 === 50%
		//peer_connected: .5, // we can reduce this, but lowering the map quality
		//peer_disconnected: .5
	},
}
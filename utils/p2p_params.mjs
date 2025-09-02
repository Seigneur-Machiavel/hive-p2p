export const NODE = {
	SERVICE_PORT: 8080,
	PUBLIC_AUTO_BAN_DELAY: { min: 10_000, max: 30_000 },
	PUBLIC_AUTO_BAN_DURATION: 60_000,

	CONNECTION_UPGRADE_TIMEOUT: 8_000, // delay before SDP failure | default: 5_000 (5 seconds)
	ENHANCE_CONNECTION_DELAY: 2_500, // delay between connection attempts | default: 10_000 (10 seconds)
	ENHANCE_CONNECTION_RATE_BASIS: .618, // default: .618 (61.8%) (PONDERATION)
	MAX_BOOTSTRAPS_IN_CONNS: 10, // default: 10
	MAX_BOOTSTRAPS_OUT_CONNS: 2, // prod: 2, simulation we can set: 0
	MIN_CONNECTION_TIME_TO_DISPATCH_EVENT: 2_500,
	TARGET_NEIGHBORS_COUNT: 12, // default: 12
	MAX_OVERLAP: 3 // Max of shared neighbours | default: 5, strict: 2
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
	// PONDERATION
	TRANSMISSION_RATE_MOD: 2, // DECREASE TO LOWER TRANSMISSION RATE
	MIN_NEIGHBOURS_TO_APPLY_TRANSMISSION_RATE: 4, // DECREASE TO LOWER TRANSMISSION RATE SOONER
	TRANSMISSION_RATE: {
		default: 1, // .51 === 50%
		peer_connected: .618, // we can reduce this, but lowering the map quality
		peer_disconnected: .618
	},
}
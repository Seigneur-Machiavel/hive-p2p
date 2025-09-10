// THIS FILE IS TEMPORARY, BUILDING IT OVER TIME
// HOLD GLOBAL PARAMETERS FOR THE LIBRARY
// AND AVOID CIRCULAR DEPENDENCIES
export const SIMULATION = {
	ICE_DELAY: { min: 250, max: 3000 }, // simulation delay range for ICE candidates in ms | default: { min: 250, max: 3000 }
	ICE_OFFER_FAILURE_RATE: 0, 	// default: .2, 20% offer failure
	ICE_ANSWER_FAILURE_RATE: 0, 	// default: .15, 15% answer failure
}
export const TRANSPORT = {
	WS_CLIENT: WebSocket,
	//WS_SERVER: WebSocketServer,
	//PEER: SimplePeer,
	WS_SERVER: (typeof window === 'undefined') ? (await import('ws')).WebSocketServer : null,
	PEER: (typeof window === 'undefined') ? (await import('simple-peer')).default : null
}
export const IDENTIFIERS = {
	PUBLIC_NODE: 'public_',
}

export const NODE = {
	DEFAULT_VERBOSE: 4, // 0: none, 1: errors, 2: +important info, 3: +debug, 4: +everything
	CONNECTION_UPGRADE_TIMEOUT: 10_000,
	SERVICE: {
		PORT: 8080,
		AUTO_KICK_DELAY: { min: 30_000, max: 60_000 },
		AUTO_KICK_DURATION: 120_000,
		MAX_WS_IN_CONNS: 20, // default: 10
	},
	MIN_CONNECTION_TIME_TO_DISPATCH_EVENT: 2_500,
}

export const ENHANCER = {
	LOOP_DELAY: 2_500, // delay between connection attempts | default: 2_500 (2.5 seconds)
	DELAY_BETWEEN_SDP_SPREAD: 10_000, // delay between spreading SDP | default: 15_000 (15 seconds)
	DELAY_BETWEEN_SDP_RESET: 30_000, // delay between SDP reset | default: 60_000 (1 minute)
	MAX_SERVICE_OUT_CONNS: 2, // prod: 2, simulation we can set: 0
	MAX_OVERLAP: 12, // Max of shared neighbours | default: 5, strict: 2
	TARGET_NEIGHBORS_COUNT: 12, // default: 12
}

export const DISCOVERY = {
	ON_CONNECT_DISPATCH_DELAY: 0,
	CONNECTED_EVENT: true,
	DISCONNECTED_EVENT: true,
	NEIGHBOUR_GOSSIP: true,
	TRAVELED_ROUTE: true,
	GOSSIP_HISTORY: true
}

export const UNICAST = {
	SERIALIZER: JSON.stringify,
	DESERIALIZER: JSON.parse,
	MAX_HOPS: 6,
	MAX_NODES: 144, // 512, // default: 1728 (12³), light: 512 (8³), super-light: 144 (8²)
	MAX_ROUTES: 5
}

export const GOSSIP = {
	EXPIRATION: 10_000, // Time to consider a message as valid | default: 10_000 (10 seconds)
	CACHE_DURATION: 20_000, // Duration to keep messages in cache
	SERIALIZER: JSON.stringify,
	DESERIALIZER: JSON.parse,
	TTL: {
		default: 10,
		//peer_connected: 3,
		//peer_disconnected: 3,
		//my_neighbours: 3
	},
	// PONDERATION
	TRANSMISSION_RATE_MOD: 2, // DECREASE TO LOWER TRANSMISSION RATE
	MIN_NEIGHBOURS_TO_APPLY_TRANSMISSION_RATE: 4, // DECREASE TO LOWER TRANSMISSION RATE SOONER
	TRANSMISSION_RATE: {
		default: 1, // .51 === 50%
		peer_connected: .618, // we can reduce this, but lowering the map quality
		//peer_disconnected: .618
	},
}
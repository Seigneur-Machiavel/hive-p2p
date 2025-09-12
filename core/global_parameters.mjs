// THIS FILE IS TEMPORARY, BUILDING IT OVER TIME
// HOLD GLOBAL PARAMETERS FOR THE LIBRARY
// AND AVOID CIRCULAR DEPENDENCIES
export const SIMULATION = {
	ENABLED: false, // enable simulation features
	ICE_DELAY: { min: 250, max: 3000 }, // simulation delay range for ICE candidates in ms | default: { min: 250, max: 3000 }
	ICE_OFFER_FAILURE_RATE: .2, 	// default: .2, 20% offer failure
	ICE_ANSWER_FAILURE_RATE: .15, 	// default: .15, 15% answer failure

	AVOID_FOLLOWERS_NODES: true, 	// avoid twitch nodes creation | default: true
	AUTO_START: true,				// auto start the simulation, false to wait the frontend | default: true
	PUBLIC_PEERS_COUNT: 3,			// stable: 3,  medium: 100, strong: 200 | default: 3
	PEERS_COUNT: 10,				// stable: 25, medium: 800, strong: 1600 | default: 10
	BOOTSTRAPS_PER_PEER: 10,		// will not be exact, more like a limit. null = all of them | default: 10
	DELAY_BETWEEN_INIT: 10,			// 0 = faster for simulating big networks but > 0 = should be more realistic | default: 10
	RANDOM_UNICAST_PER_SEC: 1,		// default: .1, capped at a total of 500msg/sec | default: 1
	RANDOM_GOSSIP_PER_SEC: 1,		// default: 0, capped at a total of 200msg/sec | default: 1
}

export const TRANSPORTS = {
	MAX_SDP_OFFERS: 3, // max SDP offers to create in advance | default: 3
	SDP_OFFER_EXPIRATION: 30_000, // duration to consider an SDP offer as valid | default: 30_000 (30 seconds)
	WS_CLIENT: WebSocket,
	//WS_SERVER: WebSocketServer,
	//PEER: SimplePeer,
	WS_SERVER: (typeof window === 'undefined') ? (await import('ws')).WebSocketServer : null,
	PEER: (typeof window === 'undefined') ? (await import('simple-peer')).default : null
}

export const IDENTIFIERS = {
	PUBLIC_NODE: 'public_',
	STANDARD_NODE: 'peer_',
}

export const NODE = {
	DEFAULT_VERBOSE: 3, // 0: none, 1: errors, 2: +important info, 3: +debug, 4: +everything
	CONNECTION_UPGRADE_TIMEOUT: 10_000,
	SERVICE: {
		PORT: 8080,
		AUTO_KICK_DELAY: { min: 15_000, max: 60_000 }, // default: { min: 30_000, max: 60_000 }
		AUTO_KICK_DURATION: 120_000, // default: 60_000 (1 minute)
		MAX_WS_IN_CONNS: 20, // default: 10
		MAX_WS_OUT_CONNS: 2, // default: 2
	},
}

export const DISCOVERY = {
	MAX_OVERLAP: 5, // Max of shared neighbours | default: 5, strict: 2
	LOOP_DELAY: 2_500, // delay between connection attempts | default: 2_500 (2.5 seconds)
	TARGET_NEIGHBORS_COUNT: 12, // default: 12
	ON_CONNECT_DISPATCH: {
		DELAY: 100, // delay before dispatching the 'connected' event | default: 500 (.5 seconds)
		SEND_EVENT: true,
		GOSSIP_NEIGHBOUR: true,
		GOSSIP_HISTORY: false
	},
	ON_DISCONNECT_DISPATCH: {
		MIN_CONNECTION_TIME: 0, // minimum connection time to dispatch the 'disconnected' event | default: 2_500 (2.5 seconds)
		DELAY: 1000, // delay before dispatching the 'disconnected' event | default: 500 (.5 seconds)
		SEND_EVENT: true,
	},
	ON_UNICAST: {
		DIGEST_TRAVELED_ROUTE: true,
	}
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
	MIN_NEIGHBOURS_TO_APPLY_TRANSMISSION_RATE: 4, // DECREASE TO LOWER TRANSMISSION RATE SOONER, default: 4
	TRANSMISSION_RATE: {
		default: 1, // .51 === 50%
		peer_connected: .618, // we can reduce this, but lowering the map quality
		//peer_disconnected: .618
	},
}
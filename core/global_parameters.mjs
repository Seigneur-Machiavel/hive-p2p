const isNode = (typeof window === 'undefined');
// HOLD: GLOBAL PARAMETERS FOR THE LIBRARY
// AVOID: CIRCULAR DEPENDENCIES AND TOO MANY FUNCTION/CONSTRUCTOR PARAMETERS
// SIMPLIFY: IMPORTS, SIMULATOR AND BROWSER SUPPORT

export const SIMULATION = {
	AVOID_CRYPTO: false,		// avoid crypto operations for faster simulation | default: false
	USE_TEST_TRANSPORTS: true, 	// enable simulation features
	ICE_DELAY: { min: 250, max: 3000 }, // ICE candidates in ms | default: { min: 250, max: 3000 }
	ICE_OFFER_FAILURE_RATE: .2, 	// default: .2, 20% offer failure
	ICE_ANSWER_FAILURE_RATE: .15, 	// default: .15, 15% answer failure

	AVOID_FOLLOWERS_NODES: false, 	// avoid twitch nodes creation | default: true
	AUTO_START: true,				// auto start the simulation, false to wait the frontend | default: true
	PUBLIC_PEERS_COUNT: 100,		// stable: 3,  medium: 100, strong: 200 | default: 2
	PEERS_COUNT: 800,				// stable: 25, medium: 800, strong: 1600 | default: 12
	BOOTSTRAPS_PER_PEER: 10,		// will not be exact, more like a limit. null = all of them | default: 10
	DELAY_BETWEEN_INIT: 10,			// 0 = faster for simulating big networks but > 0 = should be more realistic | default: 10
	RANDOM_UNICAST_PER_SEC: .1,		// default: .1, capped at a total of 500msg/sec | default: 1
	RANDOM_GOSSIP_PER_SEC: .1,		// default: 0, capped at a total of 200msg/sec | default: 1
	MAX_WS_IN_CONNS: 20, 			// Limit of WebSocketServer incoming connections | default: 20
}

export const NODE = {
	DEFAULT_VERBOSE: 2, // 0: none, 1: errors, 2: +important info, 3: +debug, 4: +everything
	IS_BROWSER: (typeof window !== 'undefined'),
	CONNECTION_UPGRADE_TIMEOUT: 15_000, // time to close connection of connecting peer | default: 15_000 (15 seconds), to make signal throw: 4_000 (4 seconds)
	SERVICE: {
		PORT: 8080,
		AUTO_KICK_DELAY: { min: 20_000, max: 60_000 }, // default: { min: 20_000, max: 60_000 }
		AUTO_KICK_DURATION: 120_000, // default: 60_000 (1 minute)
		MAX_WS_OUT_CONNS: 2, 		// Max outgoing WebSocket connections to public nodes | default: 2
	},
}

export const IDENTITY = {
	ID_LENGTH: 16,								// length of peer id | default: 16
	PUBKEY_LENGTH: 32,							// length of public/private keys | (ed25519) default: 32 bytes
	PRIVATEKEY_LENGTH: 32,						// length of private key | (ed25519) default: 32 bytes
	SIGNATURE_LENGTH: 64,						// length of signature | default: 64 bytes
	PUBLIC_PREFIX: 'P', 						// Identifier prefix for public nodes | default: 'P'
}

export const TRANSPORTS = {
	MAX_SDP_OFFERS: 3, 				// max SDP offers to create in advance | default: 3
	SIGNAL_CREATION_TIMEOUT: 8_000, // time to wait for signal before destroying WTRC connection | default: 8_000 (8 seconds) | note: SimplePeer have a internal timeout of 5 secondes, we should be above that
	SDP_OFFER_EXPIRATION: 30_000, 	// duration to consider an SDP offer as valid | default: 30_000 (30 seconds)
	WS_CLIENT: WebSocket,			// Simulation: patched with TestWsConnection (this one can be used as a server too)
	WS_SERVER: isNode ? (await import('ws')).WebSocketServer : null, // Simulation: patched with TestWsServer
	PEER: isNode ? (await import('simple-peer')).default : null	,    // Production: patched with TestTransport
}

export const DISCOVERY = {
	PEER_LINK_DELAY: 10_000,
	MAX_OVERLAP: 5, 			// Max of shared neighbours | default: 5, strict: 2
	LOOP_DELAY: 2_500, 			// delay between connection attempts | default: 2_500 (2.5 seconds)
	TARGET_NEIGHBORS_COUNT: 12, // default: 12
	ON_CONNECT_DISPATCH: {		// => on Node.#onConnect()
		DELAY: 100, 			// delay before dispatching events | default: 100 (.1 seconds)
		SEND_EVENT: true,		// Boolean to indicate if we broadcast 'peer_connected'
		SEND_NEIGHBORS: false,	// Boolean to indicate if we broadcast 'my_neighbours' // DISABLED FOR NOW
	},
	ON_DISCONNECT_DISPATCH: {	// => on Node.#onDisconnect()
		MIN_CONNECTION_TIME: 0, // minimum connection time to dispatch the 'disconnected' event | default: 2_500 (2.5 seconds)
		DELAY: 1000, // delay before dispatching the 'disconnected' event | default: 500 (.5 seconds)
		SEND_EVENT: true,		// Boolean to indicate if we broadcast 'peer_disconnected'
	},
	ON_UNICAST: {				// => UnicastMessager.handleDirectMessage()
		DIGEST_TRAVELED_ROUTE: true, // Boolean to indicate if we digest the traveled route for each unicast message | default: true
	}
}

export const UNICAST = { // MARKERS RANGE: 0-127
	MAX_HOPS: 6,	// default: 6, light: 4, super-light: 2
	MAX_NODES: 512, // default: 1728 (12³), light: 512 (8³), super-light: 144 (8²)
	MAX_ROUTES: 5, 	// default: 5, light: 3, super-light: 1
	MARKERS_BYTES: {
		message: 0,
		'0': 'message',
		handshake: 1,
		'1': 'handshake',
		signal_answer: 2,
		'2': 'signal_answer'
	},
}

export const GOSSIP = { // MARKERS RANGE: 128-255
	EXPIRATION: 10_000, 	// Time to consider a message as valid | default: 10_000 (10 seconds)
	CACHE_DURATION: 20_000, // Duration to keep messages in cache
	HOPS: {
		default: 10,
		// signal: 5,
		// peer_connected: 3,
		// peer_disconnected: 3,
		// my_neighbours: 3
	},
	TRANSMISSION_RATE: {
		MIN_NEIGHBOURS_TO_APPLY_PONDERATION: 4, // DECREASE TO APPLY PONDERATION SOONER, default: 4
		NEIGHBOURS_PONDERATION: 2, 	// DECREASE TO LOWER TRANSMISSION RATE BASED ON NEIGHBOURS COUNT, default: 2
		default: 1, 				// .51 === 50%
		peer_connected: .618, 		// we can reduce this, but lowering the map quality
		//peer_disconnected: .618
	},
	MARKERS_BYTES: {
		gossip: 128,
		'128': 'gossip',
		signal_offer: 129,
		'129': 'signal_offer',
		peer_connected: 130,
		'130': 'peer_connected',
		peer_disconnected: 131,
		'131': 'peer_disconnected',
		my_neighbours: 132,
		'132': 'my_neighbours',
	},
}
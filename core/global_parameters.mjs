const isNode = (typeof window === 'undefined');
import { Clock } from '../services/clock.mjs';
// HOLD: GLOBAL PARAMETERS FOR THE LIBRARY
// AVOID: CIRCULAR DEPENDENCIES AND TOO MANY FUNCTION/CONSTRUCTOR PARAMETERS
// SIMPLIFY: IMPORTS, SIMULATOR AND BROWSER SUPPORT

export const CLOCK = Clock.instance;

export const SIMULATION = {
	// FACILITIES TO SIMULATE NETWORK CONDITIONS AND SCENARIOS
	AVOID_INTERVALS: true,			// avoid intervals for faster simulation | default: true
	USE_TEST_TRANSPORTS: true, 		// enable simulation features
	ICE_DELAY: { min: 250, max: 3000 }, // ICE candidates in ms | default: { min: 250, max: 3000 }
	ICE_OFFER_FAILURE_RATE: .2, 	// default: .2, 20% offer failure
	ICE_ANSWER_FAILURE_RATE: .15, 	// default: .15, 15% answer failure
	// SIMULATOR OPTIONS
	AVOID_FOLLOWERS_NODES: false, 	// avoid twitch nodes creation | default: true
	AUTO_START: true,				// auto start the simulation, false to wait the frontend | default: true
	PUBLIC_PEERS_COUNT: 100,		// stable: 3,  medium: 20,  strong: 100 | default: 2
	PEERS_COUNT: 4900,				// stable: 25, medium: 800, strong: 4900 | default: 12
	BOOTSTRAPS_PER_PEER: 10,		// will not be exact, more like a limit. null = all of them | default: 10
	DELAY_BETWEEN_INIT: 60,			// 0 = faster for simulating big networks but > 0 = should be more realistic | default: 60 (60sec to start 1000 peers)
	RANDOM_UNICAST_PER_SEC: 0,		// default: .1, capped at a total of 500msg/sec | default: 1
	RANDOM_GOSSIP_PER_SEC: 0,		// default: 0, capped at a total of 200msg/sec | default: 1
	DIFFUSION_TEST_DELAY: 10_000,	// frequency of diffusion test | default: 20_000 (20 seconds)
	DIFFUSION_TEST_HOPS: 10,		// HOPS for diffusion test | default: 10
}

export const NODE = {
	DEFAULT_VERBOSE: 1, // 0: none, 1: errors, 2: +important info, 3: +debug, 4: +everything
	IS_BROWSER: isNode ? false : true,	// Flag to indicate if we are running in a browser environment
	CONNECTION_UPGRADE_TIMEOUT: 15_000, // time to close connection of connecting peer | default: 15_000 (15 seconds), to make signal throw: 4_000 (4 seconds)
	SERVICE: {
		PORT: 8080,
		AUTO_KICK_DELAY: { min: 30_000, max: 60_000 }, // default: { min: 30_000, max: 60_000 }
		AUTO_KICK_DURATION: 60_000, // default: 60_000 (1 minute)
		MAX_WS_IN_CONNS: 20, 		// Limit of WebSocketServer incoming connections | default: 20
		MAX_WS_OUT_CONNS: 2, 		// Max outgoing WebSocket connections to public nodes | default: 2
	},
}

export const IDENTITY = {
	ARE_IDS_HEX: false,				// Boolean to indicate if we use hex ids, default: true = hex | false = strings as Bytes (can involve in serialization failures)
	PUBLIC_PREFIX: '0', 			// Identifier prefix for public nodes | default: '0'
	ID_LENGTH: 16,					// !!EVEN NUMBER ONLY!! length of peer id | default: 16
	PUBKEY_LENGTH: 32,				// length of public/private keys | (ed25519) default: 32 bytes
	PRIVATEKEY_LENGTH: 32,			// length of private key | (ed25519) default: 32 bytes
	SIGNATURE_LENGTH: 64,			// length of signature | default: 64 bytes
}
if (!IDENTITY.ARE_IDS_HEX) IDENTITY.PUBLIC_PREFIX = 'P_'; // FOR SIMULTOR STRING IDS

export const TRANSPORTS = {
	MAX_SDP_OFFERS: 3, 				// max SDP offers to create in advance | default: 3
	SIGNAL_CREATION_TIMEOUT: 8_000, // time to wait for signal before destroying WTRC connection | default: 8_000 (8 seconds) | note: SimplePeer have a internal timeout of 5 secondes, we should be above that
	SDP_OFFER_EXPIRATION: 40_000, 	// duration to consider an SDP offer as valid | default: 40_000 (40 seconds)
	WS_CLIENT: WebSocket,			// Simulation: patched with TestWsConnection (this one can be used as a server too)
	WS_SERVER: isNode ? (await import('ws')).WebSocketServer : null, // Simulation: patched with TestWsServer
	PEER: isNode ? (await import('simple-peer')).default : null	,    // Production: patched with TestTransport
}

export const DISCOVERY = {
	PEER_LINK_DELAY: 10_000,
	MAX_OVERLAP: 4, 				// Max of shared neighbours | soft: 5, default: 4, strict: 3
	LOOP_DELAY: 2_500, 				// delay between connection attempts | default: 2_500 (2.5 seconds)
	TARGET_NEIGHBORS_COUNT: 5, 		// default: 8, light: 6, super-light: 4
	ON_CONNECT_DISPATCH: {		// => on Node.#onConnect()
		DELAY: 0, 					// delay before dispatching events | default: 100 (.1 seconds)
		BROADCAST_EVENT: false,		// Boolean to indicate if we broadcast 'peer_connected'
		SHARE_HISTORY: false,		// Boolean to indicate if we broadcastToPeer some gossip history to the new peer | default: true
	},
	ON_DISCONNECT_DISPATCH: {	// => on Node.#onDisconnect()
		MIN_CONNECTION_TIME: 2_500, // minimum connection time to dispatch the 'disconnected' event | default: 2_500 (2.5 seconds)
		DELAY: 0, 					// delay before dispatching the 'disconnected' event | default: 500 (.5 seconds)
		BROADCAST_EVENT: false,		// Boolean to indicate if we broadcast 'peer_disconnected'
	},
	ON_UNICAST: {				// => UnicastMessager.handleDirectMessage()
		DIGEST_TRAVELED_ROUTE: true, // Boolean to indicate if we digest the traveled route for each unicast message | default: true
	}
}

export const UNICAST = { // MARKERS RANGE: 0-127
	MAX_HOPS: 6,	// default: 6, light: 4, super-light: 2
	MAX_NODES: 256, // BFS option | default: 1728 (12³), light: 512 (8³), super-light: 144 (8²)
	MAX_ROUTES: 5, 	// BFS option | default: 5, light: 3, super-light: 1
	MARKERS_BYTES: { // FIRST BYTE MARKER | RANGE: 0-127
		message: 0,
		'0': 'message',
		handshake: 1,
		'1': 'handshake',
		signal_answer: 2,
		'2': 'signal_answer',
		signal_offer: 3,
		'3': 'signal_offer',
	},
}

export const GOSSIP = { // MARKERS RANGE: 128-255
	EXPIRATION: 10_000, 	// Time to consider a message as valid | default: 10_000 (10 seconds)
	CACHE_DURATION: 20_000, // Duration to keep messages in cache
	HOPS: { // GOSSIP LIMITATION > LIMITING THE HOPS BASED ON THE MESSAGE TYPE
		default: 16, 		// 16 should be the maximum
		// signal_offer: 6, // works with 3
		// peer_connected: 3,
		// peer_disconnected: 3,
	},
	TRANSMISSION_RATE: { // GOSSIP PONDERATION > LOWERING THE TRANSMISSION RATE BASED ON NEIGHBOURS COUNT
		MIN_NEIGHBOURS_TO_APPLY_PONDERATION: 2, // DECREASE TO APPLY PONDERATION SOONER, default: 4
		NEIGHBOURS_PONDERATION: 5, 	// DECREASE TO LOWER TRANSMISSION RATE BASED ON NEIGHBOURS COUNT, default: 2
		default: 1, 				// .51 === 50%
		signal_offer: .618, 		// 1 === 100%
		// peer_connected: .5, 		// we can reduce this, but lowering the map quality
		// peer_disconnected: .618
	},
	MARKERS_BYTES: { // FIRST BYTE MARKER | RANGE: 128-255
		gossip: 128,
		'128': 'gossip',
		signal_offer: 129,
		'129': 'signal_offer',
		peer_connected: 130,
		'130': 'peer_connected',
		peer_disconnected: 131,
		'131': 'peer_disconnected',
		diffusion_test: 132,
		'132': 'diffusion_test',
	},
}
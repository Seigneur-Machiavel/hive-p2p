const isNode = (typeof window === 'undefined');
if (!isNode) (await import('../libs/simplepeer-9.11.1.min.js')).default;

// HOLD: GLOBAL CONFIG FOR THE LIBRARY
// AVOID: CIRCULAR DEPENDENCIES AND TOO MANY FUNCTION/CONSTRUCTOR CONFIG
// SIMPLIFY: IMPORTS, SIMULATOR AND BROWSER SUPPORT

export const SIMULATION = {
	/** Specify setInterval() avoidance for faster simulation (true = avoid intervals) | Default: true */
	AVOID_INTERVALS: false,
	/** Use test transports (WebSocket server and SimplePeer replacement) | Default: false */
	USE_TEST_TRANSPORTS: false,
	/** Ice candidates delay simulation | Default: { min: 250, max: 3000 } */
	ICE_DELAY: { min: 250, max: 3000 },
	/** ICE offer failure rate simulation (0 to 1) | Default: .2 (20%) */
	ICE_OFFER_FAILURE_RATE: .2,
	/** ICE answer failure rate simulation (0 to 1) | Default: .15 (15%) */
	ICE_ANSWER_FAILURE_RATE: .15,
	// -------------------------------------------------|
	/** Avoid creating follower nodes | Default: false */
	AVOID_FOLLOWERS_NODES: false,
	/** Auto start the simulation when creating the first node | Default: true */
	AUTO_START: true,				// auto start the simulation, false to wait the frontend | Default: true
	/** Number of public nodes to create in the simulation
	 * - Default: 100
	 * - min: 1, medium: 3, strong: 20, hardcore: 100 */
	PUBLIC_PEERS_COUNT: 100,
	/** Number of standard nodes to create in the simulation
	 * - Default: 1860
	 * - stable: 12, medium: 250, strong: 2000, hardcore: 5000 */
	PEERS_COUNT: 1860,
	/** Number of bootstrap(public) nodes to provide as bootstrap to each peer on creation | Default: 10, null = all of them */
	BOOTSTRAPS_PER_PEER: 10,
	/** Delay between each peer.start() in milliseconds
	 * - Default: 60 (60sec to start 1000 peers)
	 * - 0 = faster for simulating big networks but > 0 = should be more realistic */
	DELAY_BETWEEN_INIT: 10,
	/** Random unicast(direct) messages to send per second | Default: 0, max: 1 (per peer) */
	RANDOM_UNICAST_PER_SEC: 0,
	/** Random gossip(to all) messages to send per second | Default: 0, max: 1 (per peer) */
	RANDOM_GOSSIP_PER_SEC: 0,
	/** Delay between each diffusion test in milliseconds | Default: 10_000 (10 seconds) */
	DIFFUSION_TEST_DELAY: 10_000,
}

export const NODE = {
	/** 0: none, 1: errors, 2: +important info, 3: +debug, 4: +everything | Can be bypass by some constructors */
	DEFAULT_VERBOSE: 2,
	/** Timeout for upgrading a "connecting" peer to "connected" | Default: 15_000 (15 seconds) */
	CONNECTION_UPGRADE_TIMEOUT: 15_000,
	/** Flag to indicate if we are running in a browser environment | DON'T MODIFY THIS VALUE */
	IS_BROWSER: isNode ? false : true,
	/** Enable manual banning of peers through the Arbiter module | Default: false (useful for consensus based ban, arbiter.trustBalances remain accessible) */
	MANUAL_BAN_MODE: false
}

export const SERVICE = {
	/** If the node is a public node (domain provided), it will start a WebSocket server on this port | Default: 8080 */
	PORT: 8080,
	/** The public node kicking basis delay | Default: 60_000 (1 minute) */
	AUTO_KICK_DELAY: 60_000,
	/** The public node kicking duration | Default: 30_000 (30 seconds) */
	AUTO_KICK_DURATION: 30_000,
	/** The public node will limit the maximum incoming connections to this value | Default: 20 */
	MAX_WS_IN_CONNS: 20,
}

export const IDENTITY = {
	/** Difficulty level for anti-sybil measures, based on Argon2id Proof-of-Work
	 * - Follow a logarithmic scale (2^x)
	 * - Default: 0 (disabled)
	 * - RECOMMENDED: 7 (medium security, reasonable CPU usage)
	 * - HIGH SECURITY: 10 (high security, significant CPU usage)
	 * - Note: This setting is applied only if ARE_IDS_HEX = TRUE */
	DIFFICULTY: 0,
	/** Memory usage in KiB for Argon2
	 * - Follow a logarithmic scale (2^x)
	 * - Default: 2**16 = 65_536 (64 MiB)
	 * - RECOMMENDED: 2**17 = 131_072 (128 MiB)
	 * - HIGH SECURITY: 2**18 = 262_144 (256 MiB)
	 * - VERY HIGH SECURITY: 2**19 = 524_288 (512 MiB)
	 * - Note: This setting is applied only if ARE_IDS_HEX = TRUE */
	ARGON2_MEM: 2**16,
	/** Boolean to indicate if we use hex ids, Default: true = hex | false = strings as Bytes (can involve in serialization failures) */
	ARE_IDS_HEX: true,
	/** Identifier prefix for public nodes | Default: '0' */
	PUBLIC_PREFIX: '0',
	/** Identifier prefix for standard nodes | Default: '1' */
	STANDARD_PREFIX: '1',
	/** !!EVEN NUMBER ONLY!! length of peer id | Default: 16 */
	ID_LENGTH: 16,
	PUBKEY_LENGTH: 32,
	PRIVATEKEY_LENGTH: 32,
	SIGNATURE_LENGTH: 64,
}

export const TRANSPORTS = {
	/** If true, we always add centralized STUN servers (Google) to the STUN URLs list */
	CENTRALIZED_STUN_SERVERS: false,
	/** Maximum SDP offers to create in advance to be ready for new connections | Default: 2 */
	MAX_SDP_OFFERS: 2,
	/** Time to wait for ICE gathering to complete | Default: 1_000 (1 second) */
	ICE_COMPLETE_TIMEOUT: 1_000,
	/** Time to wait for signal before destroying WTRC connection | Default: 8_000 (8 seconds) */
	SIGNAL_CREATION_TIMEOUT: 8_000,
	/** Time to consider an SDP offer as valid | Default: 40_000 (40 seconds) */
	SDP_OFFER_EXPIRATION: 40_000,
	
	WS_CLIENT: WebSocket,
	WS_SERVER: isNode ? (await import('ws')).WebSocketServer : null,
	PEER: isNode ? (await import('simple-peer')).default : window.SimplePeer
}

export const DISCOVERY = {
	/** Delay between two peer declaring their connection to each other | Default: 10_000 (10 seconds) */
	PEER_LINK_DELAY: 10_000,
	/** Time to consider a peer connection as valid | Default: 60_000 (60 seconds) */
	PEER_LINK_EXPIRATION: 60_000,
	/** Delay between two discovery loops | Default: 2_500 (2.5 seconds) */
	LOOP_DELAY: 2_500,
	/** Target number of neighbors to maintain, higher values improve connectivity/resilience but increase resource usage
	 * - Default: 5
	 * - Light: 4, Medium: 5, Strong: 8, Hardcore: 12 */
	TARGET_NEIGHBORS_COUNT: 5,

	ON_CONNECT_DISPATCH: {		// => on Node.#onConnect() // DEPRECATING
		DELAY: 0, 					// delay before dispatching events | Default: 100 (.1 seconds)
		BROADCAST_EVENT: false,		// Boolean to indicate if we broadcast 'peer_connected'
		OVER_NEIGHBORED: true,		// Boolean to indicate if we broadcast 'over_neighbored' event when we are over neighbored | Default: true
		SHARE_HISTORY: false,		// Boolean to indicate if we broadcastToPeer some gossip history to the new peer | Default: true
	},
	ON_DISCONNECT_DISPATCH: {	// => on Node.#onDisconnect() // DEPRECATING
		DELAY: 0, 					// delay before dispatching the 'disconnected' event | Default: 500 (.5 seconds)
		BROADCAST_EVENT: false,		// Boolean to indicate if we broadcast 'peer_disconnected'
	},
	ON_UNICAST: {				// => UnicastMessager.handleDirectMessage()
		DIGEST_TRAVELED_ROUTE: true, // Boolean to indicate if we digest the traveled route for each unicast message | Default: true
	}
}

export const UNICAST = { // MARKERS RANGE: 0-127
	/** Maximum number of hops(relaying) for direct message | Default: 8
	 * - Default: 8, light: 6, super-light: 4, direct-only: 2 */
	MAX_HOPS: 8,
	/** Maximum number of nodes to consider during BFS
	 * - Default: 1728 (12³), light: 512 (8³), super-light: 144 (8²) */
	MAX_NODES: 256,
	/** Maximum number of routes to consider during BFS
	 * - Default: 5, light: 3, super-light: 1 */
	MAX_ROUTES: 5,
	/** First byte markers for unicast messages | RANGE: 0-127 */
	MARKERS_BYTES: {
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
	/** Time to consider a message as valid | Default: 10_000 (10 seconds) */
	EXPIRATION: 10_000,
	/** Time to keep messages in cache to avoid reprocessing | Default: 20_000 (20 seconds) */
	CACHE_DURATION: 20_000,
	/** Maximum number of hops for gossip messages | Default: 20 
	 * - Here you can set different max hops for different message types */
	HOPS: {
		default: 20, 		// 16 should be the maximum
		signal_offer: 6, 	// works with 3 ?
		diffusion_test: 100, // must be high to reach all peers
		over_neighbored: 6,
		// peer_connected: 3,
		// peer_disconnected: 3,
	},
	/** Ponderation to lower the transmission rate based on neighbors count
	 * - Lowering the transmission rate based on neighbors count, but involve a lower gossip diffusion
	 * - As well you can apply different ponderation factors for different message types */
	TRANSMISSION_RATE: {
		/** Minimum neighbors to apply ponderation, Default: 2
		 * - Decrease to apply ponderation sooner */
		MIN_NEIGHBOURS_TO_APPLY_PONDERATION: 2,
		/** Ponderation factor based on neighbors count, Default: 5
		 * - Decrease to lower transmission rate based on neighbors count */
		NEIGHBOURS_PONDERATION: 5,

		Default: 1, 				// 1 === 100%
		signal_offer: .618, 		// .618 === 61.8%
		// peer_connected: .5, 		// we can reduce this, but lowering the map quality
		// peer_disconnected: .618
	},
	/** First byte markers for gossip messages | RANGE: 128-255 */
	MARKERS_BYTES: {
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
		over_neighbored: 133,
		'133': 'over_neighbored',
	},
}

/** CSS styles for console logging */
export const LOG_CSS = {
	SIMULATOR: 'color: yellow; font-weight: bold;',
	ARBITER: 'color: white;',
	CRYPTO_CODEX: 'color: green;',
	GOSSIP: 'color: fuchsia;',
	UNICAST: 'color: cyan;',
	PEER_STORE: 'color: orange;',
	SERVICE: 'color: teal;',
	PUNISHER: { BAN: 'color: red; font-weight: bold;', KICK: 'color: darkorange; font-weight: bold;' },
}

export default { SIMULATION, NODE, TRANSPORTS, DISCOVERY, IDENTITY, UNICAST, GOSSIP, LOG_CSS };
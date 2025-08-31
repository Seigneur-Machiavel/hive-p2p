import { MESSAGER } from "../utils/p2p_params.mjs";

/**
 * @typedef {import('./peer-store.mjs').PeerStore} PeerStore
 * @typedef {import('./peer-store.mjs').KnownPeer} KnownPeer
 * @typedef {import('./peer-store.mjs').PeerConnection} PeerConnection
 * 
 * @typedef {Object} RouteInfo
 * @property {string[]} path - Array of peer IDs forming the route [from, ..., remoteId]
 * @property {number} hops - Number of hops/relays in the route (path.length - 1)
 * @property {number} score - Quality score (0-1, higher is better)
 *
 * @typedef {Object} RouteResult
 * @property {RouteInfo[]} routes - Array of found routes, sorted by quality (best first)
 * @property {boolean} success - Whether at least one route was found
 * @property {number} nodesExplored - Number of nodes visited during search
 */


/** Simple prototype of a path finder searching to sort the possible routes form peerA to peerB
 * This logic can be improved a lot, especially in terms of efficiency and flexibility.
 * I chose a BFS approach for its simplicity and completeness. */
export class RouteBuilder {
	selfId;
	/** @type {Record<string, KnownPeer>} */ knownPeers;
	/** @type {Record<string, PeerConnection>} */ connectedPeers;
	constructor(selfId = 'toto', knownPeers = {}, connectedPeers = {}) {
		this.selfId = selfId;
		this.knownPeers = knownPeers;
		this.connectedPeers = connectedPeers;
	}

	/** Find all possible routes between two peers using exhaustive BFS
	 * - CAN BE IMPROVED
	 * @param {string} from - Source peer ID
	 * @param {string} remoteId - Destination peer ID
	 * @param {number} maxRoutes - Maximum number of routes to return (default: 5)
	 * @param {number} maxHops - Maximum relays allowed (default: 3)
	 * @param {number} maxNodes - Maximum nodes to explore (default: 1728 = 12³)
	 * @param {boolean} sortByScore - Whether to sort routes by score (default: true)
	 * @returns {RouteResult} Result containing found routes and metadata */
	buildRoutes(from, remoteId, maxRoutes = 5, maxHops = 3, maxNodes = 1728, sortByScore = true) {
		if (from === remoteId) return { routes: [], success: false, nodesExplored: 0 };
		if (from === this.selfId && this.connectedPeers[remoteId])
			return { routes: [{ path: [from, remoteId] }], success: true, nodesExplored: 1 };

		let nodesExplored = 0;
		const foundRoutes = [];
		const queue = [{ node: from, path: [from], depth: 0 }]; // Initialize BFS queue with starting point
		while (queue.length > 0 && nodesExplored < maxNodes) { // Exhaustive search: explore ALL paths up to maxHops
			const { node: current, path, depth } = queue.shift();
			nodesExplored++;

			if (depth >= maxHops) continue; // Don't explore beyond max depth
			const neighbors = Object.keys(this.knownPeers[current]?.neighbours || {});
			for (const neighbor of neighbors) {
				if (path.includes(neighbor)) continue; // Skip if this would create a cycle
				
				// If we reached destination record this route or Continue exploring from this neighbor
				const newPath = [...path, neighbor];
				if (neighbor === remoteId) foundRoutes.push(newPath);
				else queue.push({ node: neighbor, path: newPath, depth: depth + 1 });
			}
		}

		if (foundRoutes.length === 0) return { routes: [], success: false, nodesExplored };
		
		const routesWithScores = foundRoutes.map(path => ({
			path,
			hops: path.length - 1,
			score: Math.max(0, 1 - (path.length * .1))
		}));
		if (sortByScore) routesWithScores.sort((a, b) => b.score - a.score); // Sort by score (best first)
		return { routes: routesWithScores.slice(0, maxRoutes), success: true,  nodesExplored };
	}
}

export class DirectMessage {
	route;
	type = 'signal';
	data;
	isFlexible;

	/**
	 * @param {string[]} route chain of peerIds to reach the target, start by sender, end by target
	 * @param {string} type type of message
	 * @param {string | Uint8Array} data message content, should be encrypted with target peer's public key
	 * @param {boolean} isFlexible Whether the message can be sent through a different route if the primary route fails, default is false
	 */
	constructor(route, type, data, isFlexible = false) {
		this.route = route;
		this.type = type;
		this.data = data;
		this.isFlexible = isFlexible;
	}
}

export class UnicastMessager {
	id;
	peerStore;
	maxHops = MESSAGER.MAX_HOPS;
	maxRoutes = MESSAGER.MAX_ROUTES;
	maxNodes = MESSAGER.MAX_NODES;

	/** @type {Record<string, Function[]>} */ callbacks = {
		'signal': [],
		'message': []
	};

	/** @param {string} peerId @param {PeerStore} peerStore */
	constructor(peerId, peerStore) {
		this.id = peerId;
		this.peerStore = peerStore;
	}

	/** @param {string} remoteId @param {string | Uint8Array} data */
	sendMessage(remoteId, type, data, spread = 1) {
		const tempConActive = this.peerStore.connecting[remoteId]?.tempTransportInstance?.readyState === 1;
		if (tempConActive && type !== 'signal') return; // 'signal' message only on temporary connections
		const pathFinder = new RouteBuilder(this.id, this.peerStore.known, this.peerStore.connected);
		const builtResult = tempConActive
			? { success: true, routes: [{ path: [this.id, remoteId] }] }
			: pathFinder.buildRoutes(this.id, remoteId, this.maxRoutes, this.maxHops, this.maxNodes, true);
		if (!builtResult.success) return { success: false, reason: 'No route found' };

		for (let i = 0; i < Math.min(spread, builtResult.routes.length); i++) {
			const msg = new DirectMessage(builtResult.routes[i].path, type, data);
			this.peerStore.sendMessageToPeer(msg.route[1], msg); // send to next peer
		}

		return { success: true, routes: builtResult.routes };
	}
	/** @param {string} from @param {DirectMessage} message */
	handleDirectMessage(from, message, log = false) {
		if (this.peerStore.isBanned(from)) return;
		const { route, type, data, isFlexible } = message;
		const myIdPosition = route.indexOf(this.id);
		if (myIdPosition === -1) return console.warn(`Direct message from ${from} to ${this.id} is not routed correctly. Route:`, route);

		const [senderId, prevId, nextId] = [route[0], route[myIdPosition - 1], route[myIdPosition + 1]];
		if (senderId === this.id) return console.warn(`Direct message from self (${this.id}) is not allowed.`);
		if (from !== prevId) return console.warn(`Direct message from ${from} to ${this.id} is not routed correctly. Expected previous ID: ${prevId}, but got: ${from}`);
		if (myIdPosition !== route.length - 1) return this.peerStore.sendMessageToPeer(nextId, message); // forward to next
		
		// ... or this node is the target of the message
		if (log) {
			if (senderId === from) console.log(`(${this.id}) Direct message received from ${senderId}: ${data}`);
			else console.log(`(${this.id}) Direct message received from ${senderId} (lastRelay: ${from}): ${data}`);
		}

		this.peerStore.digestValidRoute(route); // peer discovery by the way
		if (this.callbacks[type]) for (const cb of this.callbacks[type]) cb(senderId, data);
	}
	/** @param {'signal' | 'message'} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) throw new Error(`Unknown callback type: ${callbackType}`);
		this.callbacks[callbackType].unshift(callback);
	}
}
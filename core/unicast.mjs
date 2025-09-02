import { MESSAGER } from "../utils/p2p_params.mjs";
import { RouteBuilder_V1, RouteBuilder_V2 } from "./route-builder.mjs";
const RouteBuilder = RouteBuilder_V2; // temporary switch

/**
 * @typedef {import('./peer-store.mjs').PeerStore} PeerStore
 */

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
	pathFinder;
	maxHops = MESSAGER.MAX_HOPS;
	maxRoutes = MESSAGER.MAX_ROUTES;
	maxNodes = MESSAGER.MAX_NODES;

	/** @type {Record<string, Function[]>} */ callbacks = {
		'signal': [],
		'gossip_history': [],
		'message': []
	};

	/** @param {string} peerId @param {PeerStore} peerStore */
	constructor(peerId, peerStore) {
		this.id = peerId;
		this.peerStore = peerStore;
		this.pathFinder = new RouteBuilder(this.id, this.peerStore.known, this.peerStore.connected);
	}

	/** @param {string} remoteId @param {string | Uint8Array} data */
	sendMessage(remoteId, type, data, spread = 1) {
		const tempConActive = this.peerStore.connecting[remoteId]?.tempTransportInstance?.readyState === 1;
		if (tempConActive && type !== 'signal') return; // 'signal' message only on temporary connections
		if (remoteId === this.id) return;

		const builtResult = tempConActive
			? { success: true, routes: [{ path: [this.id, remoteId] }] }
			: this.pathFinder.buildRoutes(remoteId, this.maxRoutes, this.maxHops, this.maxNodes, true);
		//if (!builtResult.success) return { success: false, reason: 'No route found' };

		if (!builtResult.success) {
			//return { success: false, reason: 'No route found' };
			const randomNeighbourId = this.peerStore.getRandomConnectedPeerId();
			const route = [this.id, randomNeighbourId, remoteId];
			const msg = new DirectMessage(route, type, data, true);
			this.peerStore.sendMessageToPeer(route[1], msg);
		} else for (let i = 0; i < Math.min(spread, builtResult.routes.length); i++) {
			const route = builtResult.routes[i].path;
			const msg = new DirectMessage(route, type, data, true);
			this.peerStore.sendMessageToPeer(route[1], msg); // send to next peer
		}

		return { success: true, routes: builtResult.routes };
	}
	#patchRouteToReachTarget(traveledRoute = [], targetId = 'toto') {
		const builtResult = this.pathFinder.buildRoutes(targetId, this.maxRoutes, this.maxHops, this.maxNodes, true);
		if (!builtResult.success) return null;
		return [...traveledRoute.slice(0, -1), ...builtResult.routes[0].path];
	}
	#extractTraveledRoute(route = []) {
		const traveledRoute = [];
		for (const peerId of route) {
			traveledRoute.push(peerId);
			if (peerId === this.id) return traveledRoute;
		}
		return null;
	}
	/** @param {string} from @param {DirectMessage} message */
	handleDirectMessage(from, message, log = false) {
		if (this.peerStore.isBanned(from)) return;
		const { route, type, data, isFlexible } = message;
		const traveledRoute = this.#extractTraveledRoute(route);
		if (!traveledRoute) return console.warn(`Failed to extract traveled route from ${route}`);
		
		this.peerStore.digestValidRoute(traveledRoute); // peer discovery by the way
		const myIdPosition = route.indexOf(this.id);
		const [senderId, prevId, nextId, targetId] = [route[0], route[myIdPosition - 1], route[myIdPosition + 1], route[route.length - 1]];
		if (senderId === this.id) return console.warn(`Direct message from self (${this.id}) is not allowed.`);
		if (from !== prevId) return console.warn(`Direct message from ${from} to ${this.id} is not routed correctly. Expected previous ID: ${prevId}, but got: ${from}`);

		const selfIsDestination = this.id === targetId;
		if (!selfIsDestination) { // forward to next
			const { success, reason } = this.peerStore.sendMessageToPeer(nextId, message);
			if (!success && isFlexible) { // try to patch the route
				const patchedRoute = this.#patchRouteToReachTarget(traveledRoute, targetId);
				const newMsg = { route: patchedRoute, type, data, isFlexible: false };
				if (patchedRoute) this.peerStore.sendMessageToPeer(nextId, newMsg);
			}
		}
		
		// ... or this node is the target of the message
		if (log) {
			if (senderId === from) console.log(`(${this.id}) Direct message received from ${senderId}: ${data}`);
			else console.log(`(${this.id}) Direct message received from ${senderId} (lastRelay: ${from}): ${data}`);
		}

		//if (!selfIsDestination) return;
		if (this.callbacks[type]) for (const cb of this.callbacks[type]) cb(senderId, data);
	}
	/** @param {'signal' | 'message'} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) throw new Error(`Unknown callback type: ${callbackType}`);
		this.callbacks[callbackType].unshift(callback);
	}
}
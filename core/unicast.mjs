import { MESSAGER } from "./global_parameters.mjs";
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
	/** @type {Record<string, Function[]>} */ callbacks = {};
	id;
	peerStore;
	pathFinder;
	maxHops = MESSAGER.MAX_HOPS;
	maxRoutes = MESSAGER.MAX_ROUTES;
	maxNodes = MESSAGER.MAX_NODES;

	/** @param {string} selfId @param {PeerStore} peerStore */
	constructor(selfId, peerStore) {
		this.id = selfId;
		this.peerStore = peerStore;
		this.pathFinder = new RouteBuilder(this.id, this.peerStore.known, this.peerStore.connected);
	}

	/** @param {'signal' | 'message'} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) this.callbacks[callbackType] = [callback];
		else this.callbacks[callbackType].unshift(callback);
	}
	/** Send unicast message to a target
	 * @param {string} remoteId @param {string} type @param {string | Uint8Array} data
	 * @param {number} [spread] Max neighbours used to relay the message, default: 1 */
	sendMessage(remoteId, type, data, spread = 1) {
		const tempConActive = this.peerStore.connecting[remoteId]?.tempTransportInstance?.readyState === 1;
		if (tempConActive && type !== 'signal') return false; // 'signal' message only on temporary connections
		if (remoteId === this.id) return false;

		if (tempConActive) { // Special case: send 'signal' over tempCon to update the connection
			const msg = new DirectMessage([this.id, remoteId], type, data, true);
			this.peerStore.sendMessageToPeer(remoteId, msg);
			return true;
		}

		const builtResult = this.pathFinder.buildRoutes(remoteId, this.maxRoutes, this.maxHops, this.maxNodes, true);
		if (!builtResult.success) return false;

		// Caution: re-routing usage who can involve insane results
		const flexibleRouting = builtResult.success === 'blind';
		const finalSpread = flexibleRouting ? 1 : spread; // Spread only if re-routing is false
		for (let i = 0; i < Math.min(finalSpread, builtResult.routes.length); i++) {
			const route = builtResult.routes[i].path;
			const msg = new DirectMessage(route, type, data, flexibleRouting);
			this.peerStore.sendMessageToPeer(route[1], msg); // send to next peer
		}
		return true;
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
		if (from !== prevId) return; // console.warn(`Direct message from ${from} to ${this.id} is not routed correctly. Expected previous ID: ${prevId}, but got: ${from}`);

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
}
import { DISCOVERY, UNICAST } from "./global_parameters.mjs";
import { RouteBuilder_V1, RouteBuilder_V2 } from "./route-builder.mjs";
const RouteBuilder = RouteBuilder_V2; // temporary switch

/**
 * @typedef {import('./peer-store.mjs').PeerStore} PeerStore
 */

export class DirectMessage {
	/** @type {string[]} */ route;
	/** @type {'signal' | 'message'} */ type = 'signal';
	/** @type {string | Uint8Array} */ data;
	/** @type {number} */ timestamp;
	/** @type {boolean} */ isFlexible;
	/** @type {string | undefined} */ reroutedBy;

	/** 
	 * @param {string[]} route @param {'signal' | 'message'} type @param {string | Uint8Array} data
	 * @param {number} timestamp @param {boolean} isFlexible */
	static serialize(route, type, data, timestamp, isFlexible = false, reroutedBy = undefined) {
		return 'U' + UNICAST.SERIALIZER({ route, type, data, timestamp, isFlexible, reroutedBy });
	}
	static deserialize(serialized) {
		return UNICAST.DESERIALIZER(serialized.slice(1));
	}
}

export class UnicastMessager {
	/** @type {Record<string, Function[]>} */ callbacks = {};
	id;
	peerStore;
	pathFinder;
	maxHops = UNICAST.MAX_HOPS;
	maxRoutes = UNICAST.MAX_ROUTES;
	maxNodes = UNICAST.MAX_NODES;

	/** @param {string} selfId @param {PeerStore} peerStore */
	constructor(selfId, peerStore) {
		this.id = selfId;
		this.peerStore = peerStore;
		this.pathFinder = new RouteBuilder(this.id, this.peerStore);
	}

	/** @param {'signal' | 'message'} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) this.callbacks[callbackType] = [callback];
		else this.callbacks[callbackType].push(callback);
	}
	/** Send unicast message to a target
	 * @param {string} remoteId @param {string} type @param {string | Uint8Array} data
	 * @param {number} [timestamp] @param {number} [spread] Max neighbours used to relay the message, default: 1 */
	sendMessage(remoteId, type, data, timestamp = Date.now(), spread = 1) {
		if (remoteId === this.id) return false;

		const builtResult = this.pathFinder.buildRoutes(remoteId, this.maxRoutes, this.maxHops, this.maxNodes, true);
		if (!builtResult.success) return false;

		// Caution: re-routing usage who can involve insane results
		const flexibleRouting = builtResult.success === 'blind';
		const finalSpread = flexibleRouting ? 1 : spread; // Spread only if re-routing is false
		for (let i = 0; i < Math.min(finalSpread, builtResult.routes.length); i++) {
			const route = builtResult.routes[i].path;
			const msg = DirectMessage.serialize(route, type, data, timestamp, flexibleRouting);
			this.#sendMessageToPeer(route[1], msg); // send to next peer
		}
		return true;
	}
	/** @param {string} targetId @param {any} serializedMessage */
	#sendMessageToPeer(targetId, serializedMessage) {
		if (this.id === targetId) return { success: false, reason: `Cannot send message to self.` };
		const transportInstance = this.peerStore.connected[targetId]?.transportInstance;
		if (!transportInstance) return { success: false, reason: `Transport instance is not available for peer ${targetId}.` };
		try { transportInstance.send(serializedMessage); return { success: true }; }
		catch (error) { console.error(`Error sending message to ${targetId}:`, error.stack); }
		return { success: false, reason: `Error sending message to ${targetId}.` };
	}
	#extractTraveledRoute(route = []) {
		const traveledRoute = [];
		for (let i = 0; i < route.length; i++) {
			traveledRoute.push(route[i]);
			if ( route[i] === this.id) return { traveledRoute, selfPosition: i };
		}
		return { traveledRoute, selfPosition: -1 };
	}
	#patchRouteToReachTarget(traveledRoute = [], targetId = 'toto') {
		const builtResult = this.pathFinder.buildRoutes(targetId, this.maxRoutes, this.maxHops, this.maxNodes, true);
		if (!builtResult.success) return null;
		return [...traveledRoute.slice(0, -1), ...builtResult.routes[0].path];
	}
	/** @param {string} from @param {DirectMessage} message @param {any} serialized */
	handleDirectMessage(from, message, serialized, verbose = 0) {
		if (this.peerStore.isBanned(from)) return;
		const { route, type, data, timestamp, isFlexible, reroutedBy } = message;
		const { traveledRoute, selfPosition } = this.#extractTraveledRoute(route);

		// RACE CONDITION CAN OCCUR IN SIMULATION !!
		// ref: simulation/race-condition-demonstration.js
		if (selfPosition === -1)
			return this.peerStore.kickPeer(from, 0); // race condition or not => ignore message
		
		const [senderId, prevId, nextId, targetId] = [route[0], route[selfPosition - 1], route[selfPosition + 1], route[route.length - 1]];
		if (from === senderId && from === this.id) // FATAL ERROR
			throw new Error('DirectMessage senderId and from are both self id !!');
		if (senderId === this.id) // !!Attacker can modify the route to kick a peer a by building a loop
			return this.peerStore.kickPeer(from, 0); // from self is not allowed.
				
		// RACE CONDITION CAN OCCUR IN SIMULATION !!
		// ref: simulation/race-condition-demonstration.js
		if (prevId && from !== prevId)
			return this.peerStore.kickPeer(from, 0); // race condition or not => ignore message
		
		if (verbose > 2)
			if (senderId === from) console.log(`(${this.id}) Direct message received from ${senderId}: ${data}`);
			else console.log(`(${this.id}) Direct message received from ${senderId} (lastRelay: ${from}): ${data}`);
		
		if (DISCOVERY.TRAVELED_ROUTE) this.peerStore.digestValidRoute(traveledRoute);
		if (this.id === targetId) { // selfIsDestination
			for (const cb of this.callbacks[type] || []) cb(senderId, data);
			return;
		}

		// re-send the message to the next peer in the route
		const { success, reason } = this.#sendMessageToPeer(nextId, serialized);
		if (!success && isFlexible && !reroutedBy) { // try to patch the route
			const patchedRoute = this.#patchRouteToReachTarget(traveledRoute, targetId);
			if (!patchedRoute) return;
			const patchedMsg = DirectMessage.serialize(patchedRoute, type, data, timestamp, isFlexible, true);
			const nextPeerId = patchedRoute[selfPosition + 1];
			this.#sendMessageToPeer(nextPeerId, patchedMsg);
		}
	}
}
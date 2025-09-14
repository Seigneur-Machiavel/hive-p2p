import { SIMULATION, DISCOVERY, UNICAST } from "./global_parameters.mjs";
import { RouteBuilder_V1, RouteBuilder_V2 } from "./route-builder.mjs";
const { SANDBOX, ICE_CANDIDATE_EMITTER, TEST_WS_EVENT_MANAGER } = SIMULATION.ENABLED ? await import('../simulation/test-transports.mjs') : {};
const RouteBuilder = RouteBuilder_V2; // temporary switch

export class DirectMessage {
	type = 'message';
	timestamp;
	route;
	pubkey;
	data;
	signature;

	/** @param {string} type @param {number} timestamp @param {string[]} route @param {string} pubkey @param {string | Uint8Array | Object} data @param {string | undefined} signature */
	constructor(type, timestamp, route, pubkey, data, signature) {
		this.type = type; this.timestamp = timestamp; this.route = route;
		this.pubkey = pubkey; this.data = data; this.signature = signature;
	}
	getSenderId() { return this.route[0]; }
	getTargetId() { return this.route[this.route.length - 1]; }
	extractTraveledRoute(selfId = 'toto') {
		const traveledRoute = [];
		for (let i = 0; i < this.route.length; i++) {
			traveledRoute.push(this.route[i]);
			if (this.route[i] === selfId) return { traveledRoute, selfPosition: i };
		}
		return { traveledRoute, selfPosition: -1 };
	}
}
export class ReroutedDirectMessage extends DirectMessage {
	rerouterPubkey;
	newRoute;
	rerouterSignature;

	/** @param {string} type @param {number} timestamp @param {string[]} route @param {string} pubkey @param {string | Uint8Array | Object} data @param {Uint8Array} rerouterPubkey @param {string | undefined} signature @param {string[]} newRoute @param {string} rerouterSignature */
	constructor(type, timestamp, route, pubkey, data, signature, rerouterPubkey, newRoute, rerouterSignature) {
		super(type, timestamp, route, pubkey, data, signature);
		this.rerouterPubkey = rerouterPubkey; this.newRoute = newRoute; this.rerouterSignature = rerouterSignature; // patch
	}
	getRerouterId() { return this.newRoute[0]; }
}

export class UnicastMessager {
	cryptoCodec;
	verbose;
	/** @type {Record<string, Function[]>} */ callbacks = { message_handle: [] };
	id;
	peerStore;
	pathFinder;
	maxHops = UNICAST.MAX_HOPS;
	maxRoutes = UNICAST.MAX_ROUTES;
	maxNodes = UNICAST.MAX_NODES;

	/** @param {string} selfId @param {import('./crypto-codec.mjs').CryptoCodec} cryptoCodec @param {import('./peer-store.mjs').PeerStore} peerStore */
	constructor(selfId, cryptoCodec, peerStore, verbose = 0) {
		this.cryptoCodec = cryptoCodec;
		this.verbose = verbose;
		this.id = selfId;
		this.peerStore = peerStore;
		this.pathFinder = new RouteBuilder(this.id, this.peerStore);
	}

	/** @param {string} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) this.callbacks[callbackType] = [callback];
		else this.callbacks[callbackType].push(callback);
	}
	/** Send unicast message to a target
	 * @param {string} remoteId @param {string | Uint8Array | Object} data @param {string} type
	 * @param {number} [spread] Max neighbours used to relay the message, default: 1 */
	sendUnicast(remoteId, data, type = 'message', spread = 1) {
		if (remoteId === this.id) return false;

		const builtResult = this.pathFinder.buildRoutes(remoteId, this.maxRoutes, this.maxHops, this.maxNodes, true);
		if (!builtResult.success) return false;

		// Caution: re-routing usage who can involve insane results
		const finalSpread = builtResult.success === 'blind' ? 1 : spread; // Spread only if re-routing is false
		for (let i = 0; i < Math.min(finalSpread, builtResult.routes.length); i++) {
			const route = builtResult.routes[i].path;
			if (route.length > UNICAST.MAX_HOPS) {
				if (this.verbose > 0) console.warn(`Cannot send unicast message to ${remoteId} as route exceeds maxHops (${UNICAST.MAX_HOPS}).`);
				continue; // too long route
			}
			const message = this.cryptoCodec.createUnicastMessage(type, data, route);
			this.#sendMessageToPeer(route[1], message); // send to next peer
		}
		return true;
	}
	/** @param {string} targetId @param {Uint8Array} serializedMessage */
	#sendMessageToPeer(targetId, serializedMessage) {
		if (this.id === targetId) return { success: false, reason: `Cannot send message to self.` };
		const transportInstance = this.peerStore.connected[targetId]?.transportInstance;
		if (!transportInstance) return { success: false, reason: `Transport instance is not available for peer ${targetId}.` };
		try { transportInstance.send(serializedMessage); return { success: true }; }
		catch (error) { console.error(`Error sending message to ${targetId}:`, error.stack); }
		return { success: false, reason: `Error sending message to ${targetId}.` };
	}
	/** @param {string} from @param {any} serialized */
	handleDirectMessage(from, serialized) {
		if (this.peerStore.isBanned(from)) return;

		const message = this.cryptoCodec.readUnicastMessage(serialized);
		if (!message) return; // invalid message

		const route = message.newRoute || message.route;
		const { traveledRoute, selfPosition } = message.extractTraveledRoute(this.id);
		for (const cb of this.callbacks.message_handle || []) cb(from, message.data); // Simulator counter is placed here

		// RACE CONDITION CAN OCCUR IN SIMULATION !!
		// ref: simulation/race-condition-demonstration.js
		if (selfPosition === -1) throw new Error(`DirectMessage selfPosition is -1 for peer ${from}.`); // race condition or not => ignore message
		
		const [senderId, prevId, nextId, targetId] = [route[0], route[selfPosition - 1], route[selfPosition + 1], route[route.length - 1]];
		if (from === senderId && from === this.id) // FATAL ERROR
			throw new Error('DirectMessage senderId and from are both self id !!');
		if (senderId === this.id) // !!Attacker can modify the route to kick a peer a by building a loop
			return this.peerStore.kickPeer(from, 0); // from self is not allowed.
				
		// RACE CONDITION CAN OCCUR IN SIMULATION !!
		// ref: simulation/race-condition-demonstration.js
		if (prevId && from !== prevId) throw new Error(`DirectMessage previous hop id (${prevId}) does not match the actual from id (${from}).`);
		
		if (this.verbose > 3)
			if (senderId === from) console.log(`(${this.id}) Direct ${message.type} from ${senderId}: ${message.data}`);
			else console.log(`(${this.id}) Direct ${message.type} from ${senderId} (lastRelay: ${from}): ${message.data}`);
		
		if (DISCOVERY.ON_UNICAST.DIGEST_TRAVELED_ROUTE) this.peerStore.digestValidRoute(traveledRoute);
		if (this.id === targetId) { // selfIsDestination
			for (const cb of this.callbacks[message.type] || []) cb(senderId, message.data);
			return { from, senderId, targetId };
		}

		// re-send the message to the next peer in the route
		const { success, reason } = this.#sendMessageToPeer(nextId, serialized);
		if (!success && !message.rerouterSignature) { // try to patch the route
			const builtResult = this.pathFinder.buildRoutes(targetId, this.maxRoutes, this.maxHops, this.maxNodes, true);
			if (!builtResult.success) return;

			const newRoute = builtResult.routes[0].path;
			if (newRoute.length > UNICAST.MAX_HOPS) {
				if (this.verbose > 0) console.warn(`Cannot re-route unicast message to ${targetId} as new route exceeds maxHops (${UNICAST.MAX_HOPS}).`);
				return; // too long route
			}
				
			const patchedMessage = this.cryptoCodec.createReroutedUnicastMessage(serialized, newRoute);
			const nextPeerId = newRoute[selfPosition + 1];
			this.#sendMessageToPeer(nextPeerId, patchedMessage);
		}

		return { from, senderId, targetId };
	}
}
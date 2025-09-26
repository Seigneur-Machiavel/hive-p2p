import { SIMULATION, DISCOVERY, UNICAST } from "./parameters.mjs";
import { RouteBuilder_V2 } from "./route-builder.mjs";
const { SANDBOX, ICE_CANDIDATE_EMITTER, TEST_WS_EVENT_MANAGER } = SIMULATION.ENABLED ? await import('../simulation/test-transports.mjs') : {};
const RouteBuilder = RouteBuilder_V2; // temporary switch

export class DirectMessage { // TYPE DEFINITION
	type = 'message';
	timestamp;
	neighborsList;
	route;
	pubkey;
	data;
	signature;
	signatureStart; // position in the serialized message where the signature starts

	/** @param {string} type @param {number} timestamp @param {string[]} neighborsList @param {string[]} route @param {string} pubkey @param {string | Uint8Array | Object} data @param {string | undefined} signature @param {number} signatureStart */
	constructor(type, timestamp, neighborsList, route, pubkey, data, signature, signatureStart) {
		this.type = type; this.timestamp = timestamp; this.neighborsList = neighborsList;
		this.route = route; this.pubkey = pubkey; this.data = data; this.signature = signature; this.signatureStart = signatureStart;
	}
	getSenderId() { return this.route[0]; }
	getTargetId() { return this.route[this.route.length - 1]; }
	extractRouteInfo(selfId = 'toto') {
		const route = this.newRoute || this.route;
		const traveledRoute = [];
		let selfPosition = -1;
		for (let i = 0; i < route.length; i++) {
			traveledRoute.push(route[i]);
			if (route[i] === selfId) { selfPosition = i; break; }
		}
		const senderId = route[0];
		const targetId = route[route.length - 1];
		const prevId = selfPosition > 0 ? route[selfPosition - 1] : null;
		const nextId = (selfPosition !== -1) ? route[selfPosition + 1] : null;
		return { traveledRoute, selfPosition, senderId, targetId, prevId, nextId, routeLength: route.length };
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
	/** @type {Record<string, Function[]>} */ callbacks = { message_handle: [] };
	id; cryptoCodex; arbiter; peerStore; verbose; pathFinder;
	
	maxHops = UNICAST.MAX_HOPS;
	maxRoutes = UNICAST.MAX_ROUTES;
	maxNodes = UNICAST.MAX_NODES;

	/** @param {string} selfId @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex @param {import('./arbiter.mjs').Arbiter} arbiter @param {import('./peer-store.mjs').PeerStore} peerStore */
	constructor(selfId, cryptoCodex, arbiter, peerStore, verbose = 0) {
		this.id = selfId;
		this.cryptoCodex = cryptoCodex;
		this.arbiter = arbiter;
		this.peerStore = peerStore;
		this.verbose = verbose;
		this.pathFinder = new RouteBuilder(this.id, this.peerStore);
	}

	/** @param {string} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) this.callbacks[callbackType] = [callback];
		else this.callbacks[callbackType].push(callback);
	}
	/** Send unicast message to a target
	 * @param {string} remoteId @param {string | Uint8Array | Object} data @param {string} type
	 * @param {number} [spread] Max neighbors used to relay the message, default: 1 */
	sendUnicast(remoteId, data, type = 'message', spread = 1) {
		if (remoteId === this.id) return false;

		const builtResult = this.pathFinder.buildRoutes(remoteId, this.maxRoutes, this.maxHops, this.maxNodes, true);
		if (!builtResult.success) return false;

		// Caution: re-routing usage who can involve insane results
		const finalSpread = builtResult.success === 'blind' ? 1 : spread; // Spread only if re-routing is false
		for (let i = 0; i < Math.min(finalSpread, builtResult.routes.length); i++) {
			const route = builtResult.routes[i].path;
			if (route.length > UNICAST.MAX_HOPS) {
				if (this.verbose > 1) console.warn(`Cannot send unicast message to ${remoteId} as route exceeds maxHops (${UNICAST.MAX_HOPS}). BFS incurred.`);
				continue; // too long route
			}
			const message = this.cryptoCodex.createUnicastMessage(type, data, route, this.peerStore.neighborsList);
			this.#sendMessageToPeer(route[1], message); // send to next peer
		}
		return true;
	}
	/** @param {string} targetId @param {Uint8Array} serialized */
	#sendMessageToPeer(targetId, serialized) {
		if (this.id === targetId) return { success: false, reason: `Cannot send message to self.` };
		const transportInstance = this.peerStore.connected[targetId]?.transportInstance;
		if (!transportInstance) return { success: false, reason: `Transport instance is not available for peer ${targetId}.` };
		try { transportInstance.send(serialized); return { success: true }; }
		catch (error) {
			this.peerStore.kickPeer(targetId, 0, 'send-error');
			if (this.verbose > 0) console.error(`Error sending message to ${targetId}:`, error.message);
		}
		return { success: false, reason: `Error sending message to ${targetId}.` };
	}
	/** @param {string} from @param {Uint8Array} serialized */
	async handleDirectMessage(from, serialized) {
		if (this.arbiter.isBanished(from)) return this.verbose >= 3 ? console.info(`%cReceived direct message from banned peer ${from}, ignoring.`, 'color: red;') : null;

		const message = this.cryptoCodex.readUnicastMessage(serialized);
		if (!message) return this.arbiter.countPeerAction(from, 'WRONG_SERIALIZATION');
		await this.arbiter.digestMessage(from, message, serialized);
		if (this.arbiter.isBanished(from)) return; // ignore messages from banished peers
		if (this.arbiter.isBanished(message.senderId)) return; // ignore messages from banished peers

		const { traveledRoute, selfPosition, senderId, targetId, prevId, nextId } = message.extractRouteInfo(this.id);
		if (from === senderId && from === this.id) throw new Error('DirectMessage senderId and from are both self id !!');
		
		for (const cb of this.callbacks.message_handle || []) cb(); // Simulator counter
		//if (selfPosition === -1) return this.peerStore.kickPeer(from, 0, 'invalid-route'); // self not in route
		//if (prevId && from !== prevId) throw new Error(`DirectMessage previous hop id (${prevId}) does not match the actual from id (${from}).`);
		//if (senderId === this.id) // !!Attacker can modify the route to kick a peer a by building a loop
			//return this.peerStore.kickPeer(from, 0, 'self-connection'); // from self is not allowed.
		if (selfPosition === -1) return this.arbiter.adjustTrust(from, TRUST_VALUES.UNICAST_INVALID_ROUTE, 'Self not in route');
		if (prevId && from !== prevId) return this.arbiter.adjustTrust(from, TRUST_VALUES.UNICAST_INVALID_ROUTE, 'Previous hop id does not match actual from id');
		if (senderId === this.id) return this.arbiter.adjustTrust(from, TRUST_VALUES.UNICAST_INVALID_ROUTE, 'SenderId is self id');
		
		if (this.verbose > 3)
			if (senderId === from) console.log(`(${this.id}) Direct ${message.type} from ${senderId}: ${message.data}`);
			else console.log(`(${this.id}) Direct ${message.type} from ${senderId} (lastRelay: ${from}): ${message.data}`);
		
		this.peerStore.digestPeerNeighbors(senderId, message.neighborsList);
		if (DISCOVERY.ON_UNICAST.DIGEST_TRAVELED_ROUTE) this.peerStore.digestValidRoute(traveledRoute);
		if (this.id === targetId) { for (const cb of this.callbacks[message.type] || []) cb(senderId, message.data); return; } // message for self

		// re-send the message to the next peer in the route
		const { success, reason } = this.#sendMessageToPeer(nextId, serialized);
		if (!success && !message.rerouterSignature) { // try to patch the route
			const builtResult = this.pathFinder.buildRoutes(targetId, this.maxRoutes, this.maxHops, this.maxNodes, true);
			if (!builtResult.success) return;

			const newRoute = builtResult.routes[0].path;
			if (newRoute.length > UNICAST.MAX_HOPS) {
				if (this.verbose > 1) console.warn(`Cannot re-route unicast message to ${targetId} as new route exceeds maxHops (${UNICAST.MAX_HOPS}).`);
				return; // too long route
			}
				
			const patchedMessage = this.cryptoCodex.createReroutedUnicastMessage(serialized, newRoute);
			const nextPeerId = newRoute[selfPosition + 1];
			this.#sendMessageToPeer(nextPeerId, patchedMessage);
		}
	}
}
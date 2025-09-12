import { SIMULATION, IDENTIFIERS, NODE } from './global_parameters.mjs';
import { PeerConnection, KnownPeer, SdpOfferManager, Punisher } from './peer-store-managers.mjs';
import { UnicastMessager } from './unicast.mjs';
const { SANDBOX, ICE_CANDIDATE_EMITTER, TEST_WS_EVENT_MANAGER } = SIMULATION.ENABLED ? await import('../simulation/test-transports.mjs') : {};

/**
 * @typedef {import('simple-peer').Instance} SimplePeerInstance
 */

export class PeerStore {
	verbose;
	id;
	sdpOfferManager;
	punisher = new Punisher();
	/** @type {string[]} The neighbours IDs */    neighbours = []; // faster access
	/** @type {Record<string, { in: PeerConnection, out: PeerConnection }>} */ connecting = {};
	/** @type {Record<string, PeerConnection>} */ connected = {};
	/** @type {Record<string, KnownPeer>} */ 	  known = {};

	/** @type {Record<string, number>} key: peerId1:peerId2, value: expiration */
	pendingLinks = {};
	expirationManagementInterval = setInterval(() => this.#cleanupExpired(), 2000);

	/** @type {Record<string, Function[]>} */ callbacks = {
		'connect': [(peerId, direction) => this.#handleConnect(peerId, direction)],
		'disconnect': [(peerId, direction) => this.#handleDisconnect(peerId, direction)],
		'signal': [],
		'data': []
	};

	/** @param {string} selfId @param {number} [verbose] default: 0 */
	constructor(selfId, verbose = 0) { // SETUP SDP_OFFER_MANAGER CALLBACKS
		this.id = selfId;
		this.verbose = verbose;
		this.sdpOfferManager = new SdpOfferManager(selfId, verbose);

		/** @param {string} remoteId @param {any} signalData @param {string} [offerHash] answer only */
		this.sdpOfferManager.onSignal = (remoteId, signalData, offerHash) => {
			if (this.isDestroy || this.punisher.isSanctioned(remoteId)) return; // not accepted
			for (const cb of this.callbacks.signal) cb(remoteId, { signal: signalData, neighbours: this.neighbours, offerHash });
		};
		/** @param {string | undefined} remoteId @param {SimplePeerInstance} instance */
		this.sdpOfferManager.onConnect = (remoteId, instance) => {
			if (this.isDestroy) return instance?.destroy();

			// RACE CONDITION CAN OCCUR IN SIMULATION !! 
			// ref: simulation/race-condition-demonstration.js
			if (instance.isTestTransport && (!instance.remoteId && !instance.remoteWsId)) throw new Error(`Transport instance is corrupted for peer ${remoteId}.`);
			if (remoteId === this.id) throw new Error(`Refusing to connect to self (${this.id}).`);

			let peerId = remoteId;
			instance.on('close', () => { if (peerId) for (const cb of this.callbacks.disconnect) cb(peerId, instance.initiator ? 'out' : 'in'); });
			instance.on('data', data => {
				if (peerId) for (const cb of this.callbacks.data) cb(peerId, data);
				else { // First data should be handshake with id
					peerId = UnicastMessager.handleHandshake(this.id, data);
					if (!peerId) return; // handled another message or invalid handshake
					for (const cb of this.callbacks.connect) cb(peerId, instance.initiator ? 'out' : 'in');
					// already connecting the other way, but this one succeded first => close the other one
					const oppositePendingInstance = this.connecting[peerId]?.[instance.initiator ? 'in' : 'out'];
					if (oppositePendingInstance) return oppositePendingInstance.destroy();
				}
			});
			// IF WE KNOW PEER ID, WE CAN LINK IT (SHOULD BE IN CONNECTING)
			if (remoteId) for (const cb of this.callbacks.connect) cb(remoteId, instance.initiator ? 'out' : 'in');
		};
	}

		// PRIVATE METHODS
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#handleConnect(peerId, direction) { // First callback assigned in constructor
		if (!this.connecting[peerId]?.[direction]) return this.verbose > 3 ? console.info(`%cPeer with ID ${peerId} is not connecting.`, 'color: orange;') : null;
		
		const peerConn = this.connecting[peerId][direction];
		this.#removePeer(peerId, 'connecting', 'both');
		if (this.isKicked(peerId)) {
			if (this.verbose > 3) console.info(`(${this.id}) Connect => Peer with ID ${peerId} is kicked. => close()`, 'color: orange;');
			return peerConn.close();
		}

		if (this.connected[peerId]) {
			if (this.verbose > 1) console.warn(`(${this.id}) Connect => Peer with ID ${peerId} is already connected. => close()`);
			return peerConn.close();
		}
		
		// RACE CONDITION CAN OCCUR IN SIMULATION !!
		// ref: simulation/race-condition-demonstration.js
		const tI = peerConn.transportInstance; // If corrupted => close and abort operation
		if (tI.isTestTransport && (!tI.remoteId && !tI.remoteWsId)) throw new Error(`Transport instance is corrupted for peer ${peerId}.`);
		
		// CONTINUE NORMAL FLOW
		peerConn.setConnected(); // set connStartTime
		this.connected[peerId] = peerConn;
		this.neighbours.push(peerId);
		this.#linkPeers(this.id, peerId); // Add link in self store
		if (this.verbose > (peerId.startsWith(IDENTIFIERS.PUBLIC_NODE) ? 3 : 2)) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} ${peerConn.isWebSocket ? 'WebSocket' : 'WRTC'} connection established with peer ${peerId}`);
	}
	#handleDisconnect(peerId, direction) { // First callback assigned in constructor
		this.#removePeer(peerId, 'connected', direction);
		this.unlinkPeers(this.id, peerId); // Remove link in self known store
	}
	/** @param {string} remoteId @param {'connected' | 'connecting' | 'both'} [status] default: both @param {'in' | 'out' | 'both'} [direction] default: both */
	#removePeer(remoteId, status = 'both', direction = 'both') {
		if (!remoteId && remoteId === this.id) return;
		this.unlinkPeers(this.id, remoteId); // Remove link in self known store

		const [ connectingConns, connectedConn ] = [ this.connecting[remoteId], this.connected[remoteId] ];
		if (connectingConns && connectedConn) throw new Error(`Peer ${remoteId} is both connecting and connected.`);
		if (!connectingConns && !connectedConn) return;
		
		// use negation to apply to 'both' too
		if (status !== 'connecting' && (connectedConn?.direction === direction || direction === 'both')) {
			delete this.connected[remoteId];
			this.neighbours = this.neighbours.filter(id => id !== remoteId);
		}
		if (status === 'connected') return; // only remove connected
		
		const directionToRemove = direction === 'both' ? ['out', 'in'] : [direction];
		for (const dir of directionToRemove) delete connectingConns?.[dir];

		if (this.connecting[remoteId]?.['in'] || this.connecting[remoteId]?.['out']) return;
		delete this.connecting[remoteId]; // no more connection direction => remove entirely
	}
	#linkPeers(peerId1 = 'toto', peerId2 = 'tutu') {
		if (!this.known[peerId1]) this.known[peerId1] = new KnownPeer(peerId1);
		if (!this.known[peerId2]) this.known[peerId2] = new KnownPeer(peerId2);
		this.known[peerId1].setNeighbour(peerId2);
		this.known[peerId2].setNeighbour(peerId1);
	}
	#cleanupExpired(andUpdateKnownBasedOnNeighbours = true) { // Clean up expired pending connections and pending links
		const now = Date.now();
		for (const [peerId, peerConns] of Object.entries(this.connecting))
			for (const dir of ['in', 'out']) {
				if (peerConns[dir]?.pendingUntil > now) continue;
				if (this.verbose > 3) console.info(`%cPending ${dir} connection to peer ${peerId} expired.`, 'color: orange;');
				peerConns[dir]?.close();
				this.#removePeer(peerId, 'connecting', dir);
			}

		for (const [key, expiration] of Object.entries(this.pendingLinks))
			if (expiration < now) delete this.pendingLinks[key];

		if (!andUpdateKnownBasedOnNeighbours) return;
		this.neighbours = Object.keys(this.connected);
		this.digestPeerNeighbours(this.id, this.neighbours); // Update self known store
	}
	#closePeerConnections(peerId) {
		this.connected[peerId]?.close();
		this.connecting[peerId]?.['in']?.close();
		this.connecting[peerId]?.['out']?.close();
	}

	// API
	/** @param {string} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) throw new Error(`Unknown callback type: ${callbackType}`);
		this.callbacks[callbackType].push(callback);
	}
	/** Initialize/Get a connecting peer WebRTC connection (SimplePeer Instance)
	 * @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} signal
	 * @param {string} [offerHash] offer only */
	addConnectingPeer(remoteId, signal, offerHash) {
		if (remoteId === this.id) throw new Error(`Refusing to connect to self (${this.id}).`);
		
		const peerConnection = this.sdpOfferManager.getPeerConnexionForSignal(remoteId, signal, offerHash);
		if (!peerConnection) return this.verbose > 3 ? console.info(`%cFailed to get/create a peer connection for ID ${remoteId}.`, 'color: orange;') : null;

		const direction = signal.type === 'offer' ? 'in' : 'out';
		if (this.connecting[remoteId]) this.connecting[remoteId][direction] = peerConnection;
		else this.connecting[remoteId] = { [direction]: peerConnection };
		return true;
	}
	/** @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} signal @param {string} [offerHash] answer only */
	assignSignal(remoteId, signal, offerHash) {
		const peerConn = this.connecting[remoteId]?.[signal.type === 'offer' ? 'in' : 'out'];
		try {
			if (peerConn?.isWebSocket) throw new Error(`Cannot assign signal for ID ${remoteId}. (WebSocket)`);
			if (signal.type === 'answer') this.sdpOfferManager.addSignalAnswer(remoteId, signal, offerHash);
			else peerConn.transportInstance.signal(signal);
		} catch (error) { console.error(`Error signaling ${signal?.type} for ${remoteId}:`, error.stack); }
	}
	/** Link two peers if both declared the connection in a short delay(10s), trigger on:
	 * - 'peer_connected' gossip message
	 * - 'peer_connected' from gossipHistory (unicast message following onConnect) */
	handlePeerConnectedGossipEvent(peerId1 = 'toto', peerId2 = 'tutu', timeout = 10_000) {
		const key1 = `${peerId1}:${peerId2}`;
		const key2 = `${peerId2}:${peerId1}`;
		const pendingLinkExpiration = this.pendingLinks[key1] || this.pendingLinks[key2];
		if (!pendingLinkExpiration) this.pendingLinks[key1] = Date.now() + timeout;
		else { // only one pendingLinks exist, by deleting both we ensure deletion
			delete this.pendingLinks[key1];
			delete this.pendingLinks[key2];
			this.#linkPeers(peerId1, peerId2);
		}
	}
		/** Improve discovery by considering used route as peer links @param {string[]} route */
	digestValidRoute(route = []) { for (let i = 1; i < route.length; i++) this.#linkPeers(route[i - 1], route[i]); }
	/** @param {string} peerId @param {string[]} neighbours */
	digestPeerNeighbours(peerId, neighbours = []) { // Update known neighbours
		if (!peerId || !Array.isArray(neighbours)) return;
		const peerNeighbours = Object.keys(this.known[peerId]?.neighbours || {});
		for (const p of peerNeighbours) if (!neighbours.includes(p)) this.unlinkPeers(peerId, p);
		for (const p of neighbours) this.#linkPeers(peerId, p);
	}
	/** called on 'peer_disconnected' gossip message */
	unlinkPeers(peerId1 = 'toto', peerId2 = 'tutu') {
		if (this.known[peerId1]) this.known[peerId1]?.unsetNeighbour(peerId2);
		if (this.known[peerId2]) this.known[peerId2]?.unsetNeighbour(peerId1);
		if (this.known[peerId1]?.connectionsCount === 0) delete this.known[peerId1];
		if (this.known[peerId2]?.connectionsCount === 0) delete this.known[peerId2];
	}
	/** @param {string} peerId1 @param {string} [peerId2] default: this.id */
	getOverlap(peerId1, peerId2 = this.id, ignorePublic = true) {
		const p1Neighbours = Object.keys(this.known[peerId1]?.neighbours || {});
		const p2Neighbours = peerId2 === this.id ? this.neighbours : Object.keys(this.known[peerId2]?.neighbours || {});
		const sharedNeighbours = ignorePublic
		? p1Neighbours.filter(id => { if (p2Neighbours[id] && !id.startsWith(IDENTIFIERS.PUBLIC_NODE)) return p2Neighbours[id]; })
		: p1Neighbours.filter(id => p2Neighbours[id]);
		return { sharedNeighbours, overlap: sharedNeighbours.length };
	}
	destroy() {
		this.isDestroy = true;
		for (const [peerId, conn] of Object.entries(this.connected)) { this.#removePeer(peerId); conn.close(); }
		for (const [peerId, connObj] of Object.entries(this.connecting)) { this.#removePeer(peerId); connObj['in']?.close(); connObj['out']?.close(); }
		this.sdpOfferManager.destroy();
		clearInterval(this.expirationManagementInterval);
	}

	// PUNISHER API
	/** Avoid peer connection and messages @param {string} peerId @param {number} duration default: 60_000ms */
	banPeer(peerId, duration = 60_000) {
		this.punisher.sanctionPeer(peerId, 'ban', duration);
		this.#closePeerConnections(peerId);
		this.#removePeer(peerId, 'both');
	}
	isBanned(peerId) { return this.punisher.isSanctioned(peerId, 'ban'); }
	/** Avoid peer connection @param {string} peerId @param {number} duration default: 60_000ms */
	kickPeer(peerId, duration = 60_000) {
		if (duration) this.punisher.sanctionPeer(peerId, 'kick', duration);
		this.connected[peerId]?.close();
		if (this.verbose > 1) console.log(`(${this.id}) Kicked peer ${peerId} for ${duration / 1000}s.`);
	}
	isKicked(peerId) { return this.punisher.isSanctioned(peerId, 'kick'); }
}
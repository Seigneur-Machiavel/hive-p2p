import { IDENTIFIERS, NODE } from './global_parameters.mjs';
import { PeerConnection, KnownPeer, SdpOfferManager, Punisher } from './peer-store-utils.mjs';

/**
 * @typedef {import('simple-peer').Instance} SimplePeerInstance
 */

export class PeerStore {
	verbose;
	id;
	sdpOfferManager;
	punisher = new Punisher();
	/** @type {string[]} The neighbours IDs */    neighbours = []; // faster access
	/** @type {Record<string, PeerConnection>} */ connected = {};
	/** @type {Record<string, PeerConnection>} */ connecting = {};
	/** @type {Record<string, KnownPeer>} */ 	  known = {};

	/** @type {Record<string, number>} key: peerId1:peerId2, value: expiration */
	pendingLinks = {};
	/** @type {Record<string, number>} key: peerId, value: expiration */
	pendingConnections = {};
	expirationManagementInterval = setInterval(() => this.#cleanupExpired(), 2000);

	/** @type {Record<string, Function[]>} */ callbacks = {
		'connect': [(peerId, direction) => {
			if (!this.connecting[peerId]) return this.verbose > 2 ? console.warn(`Peer with ID ${peerId} is not connecting.`) : null;
			
			const peerConn = this.connecting[peerId];
			this.#removePeer(peerId, 'connecting');
			if (this.isKicked(peerId)) {
				if (this.verbose > 2) console.warn(`Peer with ID ${peerId} is kicked.`);
				return peerConn.close();
			}

			if (this.connected[peerId]) {
				if (this.verbose > 1) console.warn(`Peer with ID ${peerId} is already connected.`);
				return peerConn.close();
			}
			
			// RACE CONDITION CAN OCCUR IN SIMULATION !!
			// ref: simulation/race-condition-demonstration.js
			const tI = peerConn.transportInstance; // If corrupted => close and abort operation
			if (tI.isTestTransport && (!tI.remoteId && !tI.remoteWsId))
				return peerConn.close();
			
			// CONTINUE NORMAL FLOW
			peerConn.connStartTime = Date.now();
			this.connected[peerId] = peerConn;
			this.neighbours.push(peerId);
			this.#linkPeers(this.id, peerId); // Add link in self store
			if (this.verbose > 2) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} ${peerConn.isWebSocket ? 'WebSocket' : 'WRTC'} connection established with peer ${peerId}`);

			//this.digestPeerNeighbours(peerId, this.neighbours); // TESTING -> TO REMOVE
		}],
		'disconnect': [(peerId) => {
			this.#removePeer(peerId); // remove from connected and connecting

			//this.digestPeerNeighbours(peerId, this.neighbours); // TESTING -> TO REMOVE
		}],
		'signal': [],
		'signal_rejected': [],
		'data': []
	};

	/** @param {string} selfId @param {number} [verbose] default: 0 */
	constructor(selfId, verbose = 0) { // SETUP SDP_OFFER_MANAGER CALLBACKS
		this.id = selfId;
		this.verbose = verbose;
		this.sdpOfferManager = new SdpOfferManager(selfId, verbose);

		/** @param {string} remoteId @param {any} signalData */
		this.sdpOfferManager.onSignal = (remoteId, signalData) => {
			if (this.isDestroy || this.punisher.isSanctioned(remoteId)) return; // not accepted
			for (const cb of this.callbacks.signal) cb(remoteId, { signal: signalData, neighbours: this.neighbours });
		};
		
		/** @param {string} remoteId @param {SimplePeerInstance} transportInstance @param {'in' | 'out'} direction */
		this.sdpOfferManager.onConnect = (remoteId, transportInstance, direction) => {
			// RACE CONDITION CAN OCCUR IN SIMULATION !! 
			// ref: simulation/race-condition-demonstration.js
			const tI = transportInstance; // If corrupted => close and abort operation
			if (tI.isTestTransport && (!tI.remoteId && !tI.remoteWsId))
				throw new Error(`Transport instance is corrupted for peer ${remoteId}.`);
				
			if (this.isDestroy) return transportInstance?.destroy();
			
			if (remoteId=== this.id) // DEBUG
				throw new Error(`Refusing to connect to self (${this.id}).`);

			transportInstance.on('close', () => { for (const cb of this.callbacks.disconnect) cb(remoteId, direction); });
			transportInstance.on('data', data => { if (!this.isDestroy) for (const cb of this.callbacks.data) cb(remoteId, data); });
			for (const cb of this.callbacks.connect) cb(remoteId, direction);
		};
	}

	// API
	/** @param {string} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) throw new Error(`Unknown callback type: ${callbackType}`);
		this.callbacks[callbackType].push(callback);
	}
	/** Initialize a connecting peer WebRTC connection (SimplePeer Instance)
	 * @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} remoteSDP */
	addConnectingPeer(remoteId, remoteSDP) {
		if (!remoteSDP) throw new Error('Missing remoteSDP');
		if (!remoteId) throw new Error('Invalid remoteId');

		if (remoteId === this.id)
			throw new Error(`Refusing to connect to self (${this.id}).`);

		if (this.connected[remoteId]) return console.warn(`Peer with ID ${remoteId} is already connected.`);
		if (this.connecting[remoteId]) return console.warn(`Peer with ID ${remoteId} is already connecting.`);
		
		const peerConnection = this.sdpOfferManager.getPeerConnexionForSignal(remoteId, remoteSDP, this.verbose);
		if (!peerConnection) return; // Bad offer or is already handled by another peer => ignore.

		this.connecting[remoteId] = peerConnection;
		this.pendingConnections[remoteId] = Date.now() + NODE.WRTC.CONNECTION_UPGRADE_TIMEOUT;
	}
	/** @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} signal */
	assignSignal(remoteId, signal) {
		try {
			if (!remoteId || !signal) throw new Error('Invalid remoteId or signalData');
			const { transportInstance, direction, isWebSocket } = this.connecting[remoteId] || {};
			if (isWebSocket) throw new Error(`Cannot assign signal for ID ${remoteId}. (WebSocket)`);
			if (signal.type === 'answer') return this.sdpOfferManager.addSignalAnswer(remoteId, signal);

			if (!transportInstance || !direction) throw new Error(`[${this.id}] No connecting peer found for ID ${remoteId}.`);
			if (direction === 'out') throw new Error(`Received ${signal.type} for ${remoteId} outgoing connexion is not allowed.`);
			transportInstance.signal(signal);
		} catch (error) {
			if (error.message.includes('connexion is not allowed')) return; // avoid logging
			console.error(`Error signaling ${signal?.type} for ${remoteId}:`, error.stack);
		}
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
		if (this.known[peerId1]) this.known[peerId1].unsetNeighbour(peerId2);
		if (this.known[peerId2]) this.known[peerId2].unsetNeighbour(peerId1);
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
		const allEntries = [...Object.entries(this.connected), ...Object.entries(this.connecting)];
		for (const [peerId, conn] of allEntries) { this.#removePeer(peerId); conn.close(); }
		this.sdpOfferManager.destroy();
		clearInterval(this.expirationManagementInterval);
	}

	// PUNISHER API
	/** Avoid peer connection and messages @param {string} peerId @param {number} duration default: 60_000ms */
	banPeer(peerId, duration = 60_000) {
		this.punisher.sanctionPeer(peerId, this.connected, 'ban', duration);
		const conn = this.connected[peerId] || this.connecting[peerId];
		conn ? conn.close() : this.#removePeer(peerId, 'both');
	}
	isBanned(peerId) { return this.punisher.isSanctioned(peerId, 'ban'); }
	/** Avoid peer connection @param {string} peerId @param {number} duration default: 60_000ms */
	kickPeer(peerId, duration = 60_000) {
		if (duration) this.punisher.sanctionPeer(peerId, this.connected, 'kick', duration);
		this.connected[peerId]?.close();
	}
	isKicked(peerId) { return this.punisher.isSanctioned(peerId, 'kick'); }

	// INTERNAL METHODS
	/** @param {string} remoteId @param {'connected' | 'connecting' | 'both'} [status] default: both */
	#removePeer(remoteId, status = 'both') {
		if (!remoteId && remoteId === this.id) return;
		this.unlinkPeers(this.id, remoteId); // Remove link in self known store

		const [ connectingConn, connectedConn ] = [ this.connecting[remoteId], this.connected[remoteId] ];
		if (connectingConn && connectedConn) throw new Error(`Peer ${remoteId} is both connecting and connected.`);
		if (!connectingConn && !connectedConn) return;
		
		// use negation to apply to 'both' too
		if (status !== 'connecting') {
			delete this.connected[remoteId];
			this.neighbours = this.neighbours.filter(id => id !== remoteId);
		}
		if (status !== 'connected') {
			delete this.connecting[remoteId];
			delete this.pendingConnections[remoteId];
		}
	}
	#linkPeers(peerId1 = 'toto', peerId2 = 'tutu') {
		if (!this.known[peerId1]) this.known[peerId1] = new KnownPeer(peerId1);
		if (!this.known[peerId2]) this.known[peerId2] = new KnownPeer(peerId2);
		this.known[peerId1].setNeighbour(peerId2);
		this.known[peerId2].setNeighbour(peerId1);
	}
	#cleanupExpired() { // Clean up expired pending connections and pending links
		const now = Date.now();
		for (const [peerId, expiration] of Object.entries(this.pendingConnections))
			if (expiration > now) continue; // not expired
			else { this.connecting[peerId]?.close(); this.#removePeer(peerId, 'both'); }

		for (const [key, expiration] of Object.entries(this.pendingLinks))
			if (expiration < now) delete this.pendingLinks[key];
	}
}
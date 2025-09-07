import wrtc from 'wrtc';
import SimplePeer from 'simple-peer';
import { TestTransport } from '../simulation/test-transports.mjs';
import { IDENTIFIERS, NODE } from './global_parameters.mjs';

/**
 * @typedef {import('ws').WebSocket} WebSocket
 * @typedef {import('./unicast.mjs').DirectMessage} DirectMessage
 * @typedef {import('./gossip.mjs').GossipMessage} GossipMessage */

export class PeerConnection {
	transportInstance;
	connStartTime;
	isWebSocket;
	direction;
	peerId;

	/** 
	 * @param {string} peerId @param {SimplePeer.Instance | WebSocket} transportInstance @param {'in' | 'out'} direction */
	constructor(peerId, transportInstance, direction = 'in', isWebSocket = false) {
		this.transportInstance = transportInstance;
		this.isWebSocket = isWebSocket;
		this.direction = direction;
		this.peerId = peerId;
	}
	getConnectionDuration() { return this.connStartTime ? Date.now() - this.connStartTime : 0; }
	close() { this.isWebSocket ? this.transportInstance?.close() : this.transportInstance?.destroy(); }
}
export class KnownPeer {
	id;
	neighbours;
	connectionsCount;

	/** @param {string} id @param {Record<string, number>} neighbours key: peerId, value: timestamp */
	constructor(id, neighbours = {}) {
		this.id = id;
		this.neighbours = neighbours;
		this.connectionsCount = Object.keys(neighbours).length;
	}
	
	setNeighbour(peerId, timestamp = Date.now()) {
		if (!this.neighbours[peerId]) this.connectionsCount++;
		this.neighbours[peerId] = timestamp;
	}
	unsetNeighbour(peerId) {
		if (this.neighbours[peerId]) this.connectionsCount--;
		delete this.neighbours[peerId];
	}
}
class SdpOfferBuilder {
	transportInstancer = NODE.USE_TEST_TRANSPORT ? TestTransport : SimplePeer;
	offerRequested = true; // Flag to indicate if an offer is requested
	transportInstance = null;
	offer = null;
	answers = [];

	sdpCreationInterval = setInterval(() => {
		if (!this.offerRequested || this.offer) return;
		this.#createOffer().then(offer => {
			this.offer = offer;
			this.offerRequested = false;
		}).catch(() => {});
	}, 500);

	#createOffer(timeout = 5_000) {
		return new Promise((resolve, reject) => {
			this.transportInstance = new this.transportInstancer({ initiator: true, trickle: true, wrtc });
			this.transportInstance.on('signal', data => resolve(data));
			this.transportInstance.on('error', error => reject(error));
			setTimeout(() => reject(new Error('SDP offer generation timeout')), timeout);
		});
	}
	/** @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} remoteSDP */
	getTransportInstanceForSignal(remoteSDP) {
		if (!remoteSDP) return new this.transportInstancer({ initiator: true, trickle: true, wrtc });
		if (!remoteSDP.type || !remoteSDP.sdp) return null;
		if (remoteSDP.type === 'offer') return new this.transportInstancer({ initiator: false, trickle: true, wrtc });
		if (remoteSDP.type === 'answer') return this.transportInstance;
	}
}
class Punisher {
	/** @type {Record<string, number>} */ ban = {};
	/** @type {Record<string, number>} */ kick = {};

	/** @param {string} peerId @param {Record<string, PeerConnection>} connected */
	sanctionPeer(peerId, connected, type = 'kick', duration = 60_000) {
		this[type][peerId] = Date.now() + duration;
		connected[peerId]?.close();
	}
	isSanctioned(peerId, type = 'kick') {
		if (!this[type][peerId]) return false;
		if (this[type][peerId] < Date.now()) delete this[type][peerId];
		else return true;
	}
}
export class PeerStore {
	id;
	sdpOfferBuilder = new SdpOfferBuilder();
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
		'connect': [(peerId, direction) => this.#upgradeConnectingToConnected(peerId)],
		'disconnect': [(peerId) => this.removePeer(peerId, 'connected')],
		'signal': [],
		'signal_rejected': [],
		'data': []
	};

	constructor(selfId = 'toto') { this.id = selfId; }

	// API
	/** @param {string} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) throw new Error(`Unknown callback type: ${callbackType}`);
		this.callbacks[callbackType].unshift(callback);
	}
	/** @param {string} peerId @param {PeerConnection} peerConn */
	addConnectedPeer(remoteId, peerConn) { // Used by public node only
		if (this.connected[remoteId]) return console.warn(`Peer with ID ${remoteId} is already connected.`);
		delete this.pendingConnections[remoteId];
		delete this.connecting[remoteId];
		peerConn.connStartTime = Date.now();
		this.connected[remoteId] = peerConn;
		this.neighbours.push(remoteId);
		this.linkPeers(this.id, remoteId); // Add link in self store
	}
	/** Initialize a connecting peer WebRTC connection (SimplePeer Instance) -> process handshaking
	 * @param {string} remoteId
	 * @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} remoteSDP */
	addConnectingPeer(remoteId, remoteSDP) {
		const direction = remoteSDP?.type === 'offer' ? 'in' : 'out';
		if (!remoteId) return console.error('Invalid remoteId');
		if (this.connected[remoteId]) return console.warn(`Peer with ID ${remoteId} is already connected.`);
		if (this.connecting[remoteId]) return console.warn(`Peer with ID ${remoteId} is already connecting.`);

		const transportInstance = this.sdpOfferBuilder.getTransportInstanceForSignal(remoteSDP);
		if (!transportInstance) return console.error(`Cannot create transport instance for peer ${remoteId}.`);
		this.pendingConnections[remoteId] = Date.now() + NODE.WRTC.CONNECTION_UPGRADE_TIMEOUT;
		this.connecting[remoteId] = new PeerConnection(remoteId, transportInstance, direction);

		transportInstance.on('error', error => {
			if (error.message.includes('Failed to create answer')) return; // avoid logging
			if (error.message.includes('Transport instance already')) return; // avoid logging
			if (error.message.includes('is already linked')) return; // avoid logging
			if (error.message.includes('Simulated failure')) return; // avoid logging
			if (error.message.includes('Failed to digest')) return; // avoid logging
			if (error.message.includes('No peer found')) return; // avoid logging
			if (error.message === 'cannot signal after peer is destroyed') return; // avoid logging
			console.error(`transportInstance error for ${remoteId}:`, error.stack);
		});
		transportInstance.on('connect', () => {
			if (this.isDestroy) return;
			transportInstance.on('close', () => { if (!this.isDestroy) for (const cb of this.callbacks.disconnect) cb(remoteId, direction); });
			transportInstance.on('data', data => { if (!this.isDestroy) for (const cb of this.callbacks.data) cb(remoteId, data); });
			for (const cb of this.callbacks.connect) cb(remoteId, direction);
		});
		transportInstance.on('signal', data => {
			if (!this.isDestroy) for (const cb of this.callbacks.signal) cb(remoteId, { signal: data, neighbours: this.neighbours });
		});
	}
	/** @param {string} senderId @param {{signal: {type: 'offer' | 'answer', sdp: Record<string, string>}}} data */
	assignSignal(remoteId = 'toto', data) {
		try {
			if (!remoteId || !data || !data.signal) throw new Error('Invalid remoteId or signalData');
			const type = data.signal.type;
			const { transportInstance, direction, isWebSocket } = this.connecting[remoteId] || {};
			if (isWebSocket) return console.warn(`Cannot assign signal for ID ${remoteId}. (WebSocket)`);
			if (!transportInstance || !direction) return console.warn(`No connecting peer found for ID ${remoteId}.`);
			if (type === 'answer' && direction === 'in') throw new Error(`Received ${type} for ${remoteId} incoming connexion is not allowed.`); // DEBUG
			if (type === 'offer' && direction === 'out') throw new Error(`Received ${type} for ${remoteId} outgoing connexion is not allowed.`); // DEBUG
			transportInstance.signal(data.signal);
		} catch (error) {
			if (error.message.includes('connexion is not allowed')) return; // avoid logging
			console.error(`Error signaling ${data?.signal?.type} for ${remoteId}:`, error.stack);
		}
	}
	#upgradeConnectingToConnected(remoteId) {
		if (!this.connecting[remoteId]) return console.error(`Peer with ID ${remoteId} is not connecting.`);
		this.addConnectedPeer(remoteId, this.connecting[remoteId]);
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
			this.linkPeers(peerId1, peerId2);
		}
	}

	// PUNISHER API
	/** Avoid peer connection and messages @param {string} peerId @param {number} duration default: 60_000ms */
	banPeer(peerId, duration = 60_000) { this.punisher.sanctionPeer(peerId, this.connected, 'ban', duration); }
	isBanned(peerId) { return this.punisher.isSanctioned(peerId, 'ban'); }
	/** Avoid peer connection @param {string} peerId @param {number} duration default: 60_000ms */
	kickPeer(peerId, duration = 60_000) { this.punisher.sanctionPeer(peerId, this.connected, 'kick', duration); }
	isKicked(peerId) { return this.punisher.isSanctioned(peerId, 'kick'); }

	// STORE API
	/** Improve discovery by considering used route as peer links @param {string[]} route */
	digestValidRoute(route = []) { for (let i = 1; i < route.length; i++) this.linkPeers(route[i - 1], route[i]); }
	rejectSignal(remoteId = 'toto') { // inform remote peer that we rejected its signal
		for (const cb of this.callbacks.signal_rejected) cb(remoteId, { signal: null, neighbours: this.neighbours });
	}
	/** @param {string} peerId @param {string[]} neighbours */
	digestPeerNeighbours(peerId, neighbours = []) { // Update known neighbours
		if (!peerId || !Array.isArray(neighbours)) return;
		const peerNeighbours = Object.keys(this.known[peerId]?.neighbours || {});
		for (const p of peerNeighbours) if (!neighbours.includes(p)) this.unlinkPeers(peerId, p);
		for (const p of neighbours) this.linkPeers(peerId, p);
	}
	/** @param {string} remoteId @param {'connected' | 'connecting' | 'both'} status */
	removePeer(remoteId = 'toto', status = 'both') {
		const [ connectingConn, connectedConn ] = [ this.connecting[remoteId], this.connected[remoteId] ];
		if (connectingConn && connectedConn) throw new Error(`Peer ${remoteId} is both connecting and connected.`);
		if (!connectingConn && !connectedConn) return;
		
		if (status !== 'connecting') {
			connectedConn?.close();
			delete this.connected[remoteId];
			this.neighbours = this.neighbours.filter(id => id !== remoteId);
		}
		if (status !== 'connected') {
			connectingConn?.close();
			delete this.connecting[remoteId];
		}
	}
	linkPeers(peerId1 = 'toto', peerId2 = 'tutu') {
		if (!this.known[peerId1]) this.known[peerId1] = new KnownPeer(peerId1);
		if (!this.known[peerId2]) this.known[peerId2] = new KnownPeer(peerId2);
		this.known[peerId1].setNeighbour(peerId2);
		this.known[peerId2].setNeighbour(peerId1);
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
		for (const peerId in this.connected) this.removePeer(peerId, 'connected');
		for (const peerId in this.connecting) this.removePeer(peerId, 'connecting');
		clearInterval(this.expirationManagementInterval);
	}

	// INTERNAL METHODS
	#cleanupExpired() { // Clean up expired pending connections and pending links
		const now = Date.now();
		for (const peerId in this.pendingConnections) {
			if (this.pendingConnections[peerId] > now) continue; // not expired
			delete this.pendingConnections[peerId];
			this.removePeer(peerId, 'both');
		}

		for (const [key, expiration] of Object.entries(this.pendingLinks))
			if (expiration < now) delete this.pendingLinks[key];
	}
}
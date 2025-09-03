import wrtc from 'wrtc';
import SimplePeer from 'simple-peer';
import { TestTransport } from '../simulation/test-transports.mjs';
import { IDENTIFIERS } from './global_parameters.mjs';

/**
 * @typedef {import('ws').WebSocket} WebSocket
 * @typedef {import('./unicast.mjs').DirectMessage} DirectMessage
 * @typedef {import('./gossip.mjs').GossipMessage} GossipMessage */

export class PeerConnection {
	/** @type {WebSocket | undefined} Transport used for initial connection to public node (usually a WebSocket) */
	tempTransportInstance;
	transportInstance;
	connStartTime;
	direction;
	peerId;

	/** @param {string} peerId @param {SimplePeer.Instance} transportInstance @param {'in' | 'out'} direction */
	constructor(peerId, transportInstance, direction = 'in') {
		this.transportInstance = transportInstance;
		this.direction = direction;
		this.peerId = peerId;
	}
	setConnectionStartTime() { this.connStartTime = Date.now(); }
	getConnectionDuration() { return Date.now() - this.connStartTime; }
	close() {
		this.tempTransportInstance?.close();
		this.transportInstance?.destroy();
	}
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
	connUpgradeTimeout;
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

	constructor(selfId = 'toto', connectionUpgradeTimeout = 1000) {
		this.id = selfId;
		this.connUpgradeTimeout = connectionUpgradeTimeout;
	}

	// API
	/** @param {string} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) throw new Error(`Unknown callback type: ${callbackType}`);
		this.callbacks[callbackType].unshift(callback);
	}
	/** Initialize a connecting peer WebRTC connection (SimplePeer Instance) -> ready for handshaking
	 * @param {string} remoteId
	 * @param {WebSocket} [tempTransportInstance] optional transport (usually a WebSocket used to connect public node)
	 * @param {string} [remoteSDP] outgoing connection: undefined, incoming: SDP object string
	 * @param {boolean} useTestTransport default: false */
	addConnectingPeer(remoteId, tempTransportInstance, remoteSDP, useTestTransport = false) { // SimplePeer
		if (!remoteId) return console.error('Invalid remoteId');
		const direction = remoteSDP ? 'in' : 'out';
		if (direction === 'in' && remoteSDP.type !== 'offer') return console.error(`Invalid remote SDP type: ${remoteSDP.type}. Expected 'offer'.`);
		
		const { connected, connecting } = this;
		//if (connected[remoteId]) return console.warn(`Peer with ID ${remoteId} already connected.`), connected[remoteId];
		if (connected[remoteId]) return;
		if (connecting[remoteId]) return console.warn(`Peer with ID ${remoteId} is already connecting.`), connecting[remoteId];

		const TransportInstancer = useTestTransport ? TestTransport : SimplePeer;
		const transportInstance = new TransportInstancer({ initiator: !remoteSDP, trickle: true, wrtc });
		connecting[remoteId] = new PeerConnection(remoteId, transportInstance, direction);
		connecting[remoteId].tempTransportInstance = tempTransportInstance;

		transportInstance.on('connect', () => {
			if (this.isDestroy) return;
			for (const cb of this.callbacks.connect) cb(remoteId, direction);
			transportInstance.on('close', () => { if (!this.isDestroy) for (const cb of this.callbacks.disconnect) cb(remoteId, direction); });
			transportInstance.on('data', data => { if (!this.isDestroy) for (const cb of this.callbacks.data) cb(remoteId, data); });
		});
		transportInstance.on('signal', data => {
			if (!this.isDestroy) for (const cb of this.callbacks.signal) cb(remoteId, { signal: data, neighbours: this.neighbours });
		});
		transportInstance.on('error', error => {
			if (error.message.includes('Failed to digest')) return; // avoid logging
			if (error.message.includes('No peer found')) return; // avoid logging
			if (error.message === 'cannot signal after peer is destroyed') return; // avoid logging
			console.error(`transportInstance error for ${remoteId}:`, error.stack);
		});

		if (remoteSDP) try { transportInstance.signal(remoteSDP); } catch (error) { console.error(`Error signaling remote SDP for ${remoteId}:`, error.message); }
		this.pendingConnections[remoteId] = Date.now() + this.connUpgradeTimeout;
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
	assignSignal(remoteId = 'toto', signalData = { type: 'answer', sdp: {id: '...'} }) {
		try {
			if (!remoteId || !signalData) throw new Error('Invalid remoteId or signalData');
			if (!['answer', 'candidate'].includes(signalData.type)) throw new Error(`Invalid signal data type: ${signalData.type}. Expected 'answer' or 'candidate'.`);
			const peer = this.connecting[remoteId];
			if (signalData.type === 'answer' && peer.direction === 'in') throw new Error(`Received ${signalData.type} for ${remoteId} incoming connexion is not allowed.`);
			peer.transportInstance.signal(signalData);
		} catch (error) {
			if (error.message.includes('connexion is not allowed')) return; // avoid logging
			console.error(`Error signaling ${signalData.type} for ${remoteId}:`, error.stack);
		}
	}
	rejectSignal(remoteId = 'toto') { // inform remote peer that we rejected its signal
		for (const cb of this.callbacks.signal_rejected) cb(remoteId, { signal: null, neighbours: this.neighbours });
	}
	/** @param {string} peerId @param {string[]} neighbours */
	digestPeerNeighbours(peerId, neighbours = []) {
		if (!peerId || !Array.isArray(neighbours)) return;
		for (const p of neighbours) this.linkPeers(peerId, p);
	}
	/** @param {string} remoteId @param {'connected' | 'connecting'} status */
	removePeer(remoteId = 'toto', status = 'connecting') {
		const [ connectingConn, connectedConn ] = [ this.connecting[remoteId], this.connected[remoteId] ];
		if (connectingConn && connectedConn) throw new Error(`Peer ${remoteId} is both connecting and connected.`);
		if (!connectingConn && !connectedConn) return;
		status === 'connecting' ? connectingConn?.close() : connectedConn?.close();
		delete this[status][remoteId];
		if (status === 'connecting') return;
		this.neighbours = this.neighbours.filter(id => id !== remoteId);
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
	/** @param {string} remoteId @param {GossipMessage | DirectMessage} message */
	sendMessageToPeer(remoteId, message) {
		const transportInstance = this.connected[remoteId]?.transportInstance || this.connecting[remoteId]?.tempTransportInstance;
		if (!transportInstance) return { success: false, reason: `Transport instance is not available for peer ${remoteId}.` };
		try { transportInstance.send(JSON.stringify(message));
		} catch (error) { console.error(`Error sending message to ${remoteId}:`, error.stack); }
		return { success: true };
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
			this.removePeer(peerId, 'connecting');
		}

		for (const [key, expiration] of Object.entries(this.pendingLinks))
			if (expiration < now) delete this.pendingLinks[key];
	}
	#upgradeConnectingToConnected(remoteId) {
		if (!this.connecting[remoteId]) return console.error(`Peer with ID ${remoteId} is not connecting.`);

		const peer = this.connecting[remoteId];
		this.connected[remoteId] = peer;
		this.neighbours.push(remoteId);
		delete this.connecting[remoteId];
		delete this.pendingConnections[remoteId];
		peer.setConnectionStartTime();
		if (peer.tempTransportInstance) peer.tempTransportInstance.close();
	}
}
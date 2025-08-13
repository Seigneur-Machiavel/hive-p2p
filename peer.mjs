import wrtc from 'wrtc';
import SimplePeer from 'simple-peer';
import { TestTransport } from './p2p_test_transport.mjs';
import { VARS } from './p2p_utils.mjs';
import { GossipMessage, DirectMessage } from './p2p_message.mjs';

/**
 * @typedef {import('ws').WebSocket} WebSocket
 *
 * @typedef {Object} Store
 * @property {Object<string, PeerConnection>} connected
 * @property {Object<string, PeerConnection>} connecting
 * @property {Object<string, KnownPeer>} known
 * @property {Object<string, number>} bannedUntil
 */

/** @type {Record<string, SimplePeer>} */
const TRANSPORTS = {
	'SimplePeer': SimplePeer,
	'Test': TestTransport
}

export class PeerConnection {
	/** @type {WebSocket | undefined} Transport used for initial connection to public node (usually a WebSocket) */
	tempTransportInstance;
	transportInstance;
	direction;
	peerId;

	/** @param {string} peerId @param {SimplePeer.Instance} transportInstance @param {'in' | 'out'} direction */
	constructor(peerId, transportInstance, direction = 'in') {
		this.transportInstance = transportInstance;
		this.direction = direction;
		this.peerId = peerId;
	}
	close() {
		this.transportInstance.destroy();
	}
}
export class KnownPeer {
	/** @type {string[]} The peers that are directly connected to this peer */
	neighbours;
	connectionsCount = 0;
	id;
	constructor(id, neighbours = {}) {
		this.neighbours = neighbours;
		this.id = id;
		this.#updateConnectionsCount();
	}
	addNeighbour(peerId, timestamp = Date.now()) {
		this.neighbours[peerId] = timestamp;
		this.#updateConnectionsCount();
	}
	removeNeighbour(peerId) {
		delete this.neighbours[peerId];
		this.#updateConnectionsCount();
	}
	#updateConnectionsCount() {
		this.connectionsCount = Object.keys(this.neighbours).length;
	}
}

export class PeerStore {
	/** @type {boolean} Flag to indicate if the peer store is destroyed */
	isStoreDestroyed = false;
	/** @type {Store} */
	store = {connected: {}, connecting: {}, known: {}, bannedUntil: {}};
	onConnect = [(peerId, direction) => this.#upgradeConnectingToConnected(peerId)];
	onDisconnect = [(peerId) => this.removePeer(peerId, 'connected')];
	onSignal = [];
	onData = [];
	connectingTimeouts = {};

	constructor() {}

	/**
	 * @param {string} remoteId
	 * @param {WebSocket} [tempTransportInstance]
	 * @param {string} [remoteSDP]
	 * @param {'SimplePeer' | 'Test'} [transport] */
	addConnectingPeer(remoteId, tempTransportInstance, remoteSDP, transport = 'Test') { // SimplePeer
		if (!remoteId) return console.error('Invalid remoteId');
		const direction = remoteSDP ? 'in' : 'out';
		if (direction === 'in' && remoteSDP.type !== 'offer') return console.error(`Invalid remote SDP type: ${remoteSDP.type}. Expected 'offer'.`);
		
		const { connected, connecting } = this.store;
		if (connected[remoteId]) return console.warn(`Peer with ID ${remoteId} already connected.`), connected[remoteId];
		if (connecting[remoteId]) return console.warn(`Peer with ID ${remoteId} is already connecting.`), connecting[remoteId];

		const sCT = Date.now(); // signalCreationTime (debug)
		const Transport = TRANSPORTS[transport];
		const transportInstance = new Transport({ initiator: !remoteSDP, trickle: true, wrtc });
		connecting[remoteId] = new PeerConnection(remoteId, transportInstance, direction);
		connecting[remoteId].tempTransportInstance = tempTransportInstance;

		transportInstance.on('connect', () => {
			if (this.isStoreDestroyed) return;
			for (const cb of this.onConnect) cb(remoteId, direction);
			transportInstance.on('close', () => { if (!this.isStoreDestroyed) for (const cb of this.onDisconnect) cb(remoteId, direction); });
			transportInstance.on('data', data => { if (!this.isStoreDestroyed) for (const cb of this.onData) cb(remoteId, data); });
		});
		transportInstance.on('signal', data => { if (!this.isStoreDestroyed) for (const cb of this.onSignal) cb(remoteId, data, sCT); });
		transportInstance.on('error', error => {
			if (error.message === 'cannot signal after peer is destroyed') return; // avoid logging
			console.error(`transportInstance error for ${remoteId}:`, error.stack);
		});

		if (remoteSDP) try { transportInstance.signal(remoteSDP); } catch (error) { console.error(`Error signaling remote SDP for ${remoteId}:`, error.message); }
		this.connectingTimeouts[remoteId] = setTimeout(() =>
			this.removePeer(remoteId, 'connecting'), VARS.CONNECTION_UPGRADE_TIMEOUT);
	}
	assignConnectingPeerSignal(remoteId, signalData) {
		if (this.peerStoreIsDestroyed) return;
		if (!remoteId || !signalData) return console.error('Invalid remoteId or signalData');
		const peer = this.store.connecting[remoteId];
		if (!peer) return;

		const validTypes = ['answer', 'candidate'];
		if (!validTypes.includes(signalData.type)) return console.error(`Invalid signal data type: ${signalData.type}. Expected 'answer' or 'candidate'.`);
		if (signalData.type === 'answer' && peer.direction === 'in') // catch simultaneous opposite connections
			return console.error(`Received ${signalData.type} for ${remoteId} incoming connexion is not allowed.`);

		try { peer.transportInstance.signal(signalData); } catch (error) { console.error(`Error signaling ${signalData.type} for ${remoteId}:`, error.message); }
	}
	#upgradeConnectingToConnected(remoteId) {
		if (!this.store.connecting[remoteId]) return console.error(`Peer with ID ${remoteId} is not connecting.`);
		clearTimeout(this.connectingTimeouts[remoteId]);
		
		this.store.connected[remoteId] = this.store.connecting[remoteId];
		delete this.store.connecting[remoteId];
		delete this.connectingTimeouts[remoteId];
		if (this.store.connected[remoteId].tempTransportInstance) // close temporary transport (usually WebSocket)
			this.store.connected[remoteId].tempTransportInstance.close();
	}
	banPeer(peerId, duration = 60_000) {
		if (!peerId) return;
		this.store.bannedUntil[peerId] = Date.now() + duration;
		this.store.connected[peerId]?.close();
	}
	isBanned(peerId) {
		if (!this.store.bannedUntil[peerId]) return false;
		const remainingBanTime = this.store.bannedUntil[peerId];
		if (remainingBanTime < Date.now()) delete this.store.bannedUntil[peerId];
		else return true;
	}
	/** @param {string} remoteId @param {'connected' | 'connecting'} status */
	removePeer(remoteId, status) {
		const [ connectingConn, connectedConn ] = [ this.store.connecting[remoteId], this.store.connected[remoteId] ];
		if (connectingConn && connectedConn) throw new Error(`Peer ${remoteId} is both connecting and connected.`);
		if (!connectingConn && !connectedConn) return;

		const conn = status === 'connected' ? connectedConn : connectingConn;
		if (conn && conn.tempTransportInstance) conn.tempTransportInstance.close();
		if (conn && conn.transportInstance) conn.transportInstance.destroy();
		delete this.store[status][remoteId];
	}

	linkPeers(peerId1, peerId2) {
		if (!peerId1 || !peerId2) return;
		if (!this.store.known[peerId1]) this.store.known[peerId1] = new KnownPeer(peerId1);
		if (!this.store.known[peerId2]) this.store.known[peerId2] = new KnownPeer(peerId2);
		this.store.known[peerId1].addNeighbour(peerId2);
		this.store.known[peerId2].addNeighbour(peerId1);
	}
	unlinkPeers(peerId1 = 'toto', peerId2 = 'tutu') {
		if (!peerId1 || !peerId2) return;
		if (this.store.known[peerId1]) this.store.known[peerId1].removeNeighbour(peerId2);
		if (this.store.known[peerId2]) this.store.known[peerId2].removeNeighbour(peerId1);
		if (this.store.known[peerId1]?.connectionsCount === 0) delete this.store.known[peerId1];
		if (this.store.known[peerId2]?.connectionsCount === 0) delete this.store.known[peerId2];
	}
	digestValidRoute(route = []) { // each peerId of the route can be linked in our known peers
		for (let i = 1; i < route.length; i++)
			this.linkPeers(route[i - 1], route[i]);
	}

	/** @param {string} remoteId @param {GossipMessage | DirectMessage} message */
	sendMessageToPeer(remoteId, message) {
		const status = this.store.connected[remoteId] ? 'connected' : this.store.connecting[remoteId] ? 'connecting' : null;
		if (!status)  return { success: false, reason: `Peer with ID ${remoteId} is not connected or connecting.` };
		
		const transportInstance = status === 'connected' ? this.store.connected[remoteId].transportInstance : this.store.connecting[remoteId].tempTransportInstance;
		if (!transportInstance) return { success: false, reason: `Transport instance is not available for peer ${remoteId}.` };
		try { transportInstance.send(JSON.stringify(message));
		} catch (error) { console.error(`Error sending message to ${remoteId}:`, error.stack); }
		return { success: true };
	}

	destroy() {
		this.peerStoreIsDestroyed = true;
		for (const peerId in this.store.connected) this.removePeer(peerId, 'connected');
		for (const peerId in this.store.connecting) this.removePeer(peerId, 'connecting');
		for (const timeoutId in this.connectingTimeouts)
			{ clearTimeout(this.connectingTimeouts[timeoutId]); delete this.connectingTimeouts[timeoutId]; }
	}
}
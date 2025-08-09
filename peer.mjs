import wrtc from 'wrtc';
import SimplePeer from 'simple-peer';
import { VARS } from './p2p_utils.mjs';
import { GossipMessage, DirectMessage } from './p2p_message.mjs';
import { RouteBuilder } from './path_finder.mjs';

export class PeerConnection {
	simplePeerInstance;
	direction;
	peerId;

	/** @param {string} peerId @param {SimplePeer.Instance} simplePeerInstance @param {'in' | 'out'} direction */
	constructor(peerId, simplePeerInstance, direction = 'in') {
		this.simplePeerInstance = simplePeerInstance;
		this.direction = direction;
		this.peerId = peerId;
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

/**
 * @typedef {Object} PeerStorePeers
 * @property {Object<string, PeerConnection>} connected
 * @property {Object<string, PeerConnection>} connecting
 * @property {Object<string, KnownPeer>} known
 */

export class PeerStore {
	/** @type {PeerStorePeers} */
	peers = {
		connected: {},
		connecting: {},
		known: {}
	}
	onConnect = [
		(peerId, direction, ws) => this.#upgradeConnectingToConnected(peerId, direction, ws),
	];
	onDisconnect = [
		(peerId) => this.removeConnectedPeer(peerId)
	];
	onSignal = [];
	onData = [];
	connectingTimeouts = {};
	pathFinder = new RouteBuilder(this.peers.known);

	constructor() {}

	/** @param {string} remoteId @param {WebSocket} [ws] @param {string} [remoteSDP] */
	addConnectingPeer(remoteId, ws, remoteSDP) {
		if (remoteSDP && remoteSDP.type !== 'offer') return console.error(`Invalid remote SDP type: ${remoteSDP.type}. Expected 'offer'.`);
		const { connected, connecting } = this.peers;
		if (connected[remoteId]) return console.warn(`Peer with ID ${remoteId} already connected.`), connected[remoteId];
		if (connecting[remoteId]) return console.warn(`Peer with ID ${remoteId} is already connecting.`), connecting[remoteId];

		const simplePeerInstance = new SimplePeer({ initiator: !remoteSDP, trickle: false, wrtc });
		const direction = remoteSDP ? 'in' : 'out';
		connecting[remoteId] = new PeerConnection(remoteId, simplePeerInstance, direction);
		// mode non-fiable : = new SimplePeer({ channelConfig: { ordered: false, maxRetransmits: 0 } });
		simplePeerInstance.on('connect', () => {
			for (const cb of this.onConnect) cb(remoteId, direction, ws);
			simplePeerInstance.on('close', () => { for (const cb of this.onDisconnect) cb(remoteId, direction); });
			simplePeerInstance.on('data', data => { for (const cb of this.onData) cb(remoteId, data); });
		});
		simplePeerInstance.on('signal', data => { for (const cb of this.onSignal) cb(remoteId, data, ws); });

		if (remoteSDP) simplePeerInstance.signal(remoteSDP);
		this.connectingTimeouts[remoteId] = setTimeout(() => this.removeConnectingPeer(remoteId), VARS.CONNECTION_UPGRADE_TIMEOUT);
	}
	assignConnectingPeerSignal(remoteId, signalData) {
		if (signalData && signalData.type !== 'answer') return console.error(`Invalid signal data type: ${signalData.type}. Expected 'answer'.`);
		const connectingPeer = this.peers.connecting[remoteId];
		if (!connectingPeer) return console.error(`Peer with ID ${remoteId} does not exist.`);
		if (connectingPeer.direction === 'in') return console.error(`Received 'answer' for ${remoteId} incoming connexion is not allowed.`);

		connectingPeer.simplePeerInstance.signal(signalData);
	}
	#upgradeConnectingToConnected(remoteId, direction, ws) {
		if (direction === 'in' && ws) ws.close(); // Close the WebSocket if used for signaling
		if (!this.peers.connecting[remoteId]) return console.error(`Peer with ID ${remoteId} is not connecting.`);
		this.peers.connected[remoteId] = this.peers.connecting[remoteId];
		delete this.peers.connecting[remoteId];
		clearTimeout(this.connectingTimeouts[remoteId]);
		delete this.connectingTimeouts[remoteId];
	}
	removeConnectingPeer(remoteId) {
		if (!this.peers.connecting[remoteId]) return;
		if (this.peers.connecting[remoteId].simplePeerInstance) this.peers.connecting[remoteId].simplePeerInstance.destroy();
		delete this.peers.connecting[remoteId];
	}
	removeConnectedPeer(remoteId) {
		if (!this.peers.connected[remoteId]) return;
		if (this.peers.connected[remoteId].simplePeerInstance) this.peers.connected[remoteId].simplePeerInstance.destroy();
		delete this.peers.connected[remoteId];
	}

	linkPeers(peerId1, peerId2) {
		if (!peerId1 || !peerId2) return;
		if (!this.peers.known[peerId1]) this.peers.known[peerId1] = new KnownPeer(peerId1);
		if (!this.peers.known[peerId2]) this.peers.known[peerId2] = new KnownPeer(peerId2);
		this.peers.known[peerId1].addNeighbour(peerId2);
		this.peers.known[peerId2].addNeighbour(peerId1);
	}
	unlinkPeers(peerId1 = 'toto', peerId2 = 'tutu') {
		if (!peerId1 || !peerId2) return;
		if (this.peers.known[peerId1]) this.peers.known[peerId1].removeNeighbour(peerId2);
		if (this.peers.known[peerId2]) this.peers.known[peerId2].removeNeighbour(peerId1);
		if (this.peers.known[peerId1]?.connectionsCount === 0) delete this.peers.known[peerId1];
		if (this.peers.known[peerId2]?.connectionsCount === 0) delete this.peers.known[peerId2];
	}
	digestValidRoute(route = []) { // each peerId of the route can be linked in our known peers
		for (let i = 0; i < route.length; i++)
			if (i === 0) continue;
			else this.linkPeers(route[i - 1], route[i]);
	}

	/** @param {string} remoteId @param {GossipMessage | DirectMessage} message */
	sendMessageToPeer(remoteId, message) {
		if (!this.peers.connected[remoteId]) console.error(`Peer with ID ${remoteId} is not connected.`);
		else this.peers.connected[remoteId].simplePeerInstance.send(JSON.stringify(message));
	}
}
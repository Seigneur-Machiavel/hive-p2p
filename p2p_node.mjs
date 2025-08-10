import { PeerStore } from './peer.mjs';
import { VARS, shuffleArray } from './p2p_utils.mjs';
import { WebSocketServer } from 'ws';
import { RouteBuilder } from './path_finder.mjs';
import { GossipMessage, DirectMessage } from './p2p_message.mjs';

export class NodeP2P {
	/** @type {string | undefined} WebSocket URL (public node only) */
	publicUrl; 
	id; // should be based on crypto
	peerStore;
	bootstraps;
	opts = {
		targetNeighbors: 12, // The optimal number of neighbors to connect to
		gossipTransmissionRate: 1, // 1 = 100% retransmission
	};
	/** @type {Record<string, Record<string, Function>>} */
	gossipHandlers = {
		'peer_connected': { 'p2pnode': (senderId, data) => this.peerStore.linkPeers(data, senderId)},
		'peer_disconnected': { 'p2pnode': (senderId, data) => this.peerStore.unlinkPeers(data, senderId)},
		// Add more gossip event handlers here
	};

	/** @param {string} id The unique identifier for the node
	 * @param {Array<string>} bootstraps List of bootstrap nodes used as P2P network entry */
	constructor(id = 'toto', bootstraps = [], init = true) {
		this.id = id;
		this.peerStore = new PeerStore(id);
		this.bootstraps = shuffleArray(bootstraps);

		this.peerStore.onConnect.unshift((peerId, direction, ws) => {
			console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection established with peer ${peerId}`);
			if (direction === 'in') setTimeout(() => this.broadcast('peer_connected', peerId, 3), 1000);
		});
		this.peerStore.onDisconnect.unshift((peerId, direction) => {
			console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection closed with peer ${peerId}`);
			setTimeout(() => this.broadcast('peer_disconnected', peerId, 3), 1000);
		});
		this.peerStore.onSignal.unshift((peerId, data, ws) =>
			this.sendMessage(peerId, 'signal', data, ws));
		this.peerStore.onData.unshift((peerId, data) => {
			const deserialized = JSON.parse(data);
			if (deserialized.route) this.#handleDirectMessage(peerId, deserialized);
			else this.#handleGossipMessage(peerId, deserialized);
		});
		
		console.log(`NodeP2P initialized: ${id}`);
		if (init) this.#enhanceConnectionLoop();
	}
	// PUBLIC (BOOTSTRAP)
	setAsPublic(domain = 'localhost', port = VARS.SERVICE_NODE_PORT, upgradeTimeout = VARS.CONNECTION_UPGRADE_TIMEOUT) {
		// create simple ws server to accept incoming connections (Require to open port)
		this.wsServer = new WebSocketServer({ port });
		this.wsServer.on('error', (error) => console.error(`WebSocket error on Node #${this.id}:`, error));
		this.wsServer.on('connection', (ws) => {
			ws.on('message', (message) => {
				const parsedMessage = JSON.parse(message);
				if (parsedMessage.route.length !== 2) return console.error('Received message does not have a valid route');
				if (parsedMessage.route[1] !== this.id) return console.error(`Received message is not for this node (expected: ${this.id}, got: ${parsedMessage.route[1]})`);
				if (parsedMessage.type === 'signal') this.#handleIncomingSignal(parsedMessage.route[0], parsedMessage.data, ws);
			});
			ws.on('close', () => this.peerStore.removeConnectingPeer(ws.remoteId));
			setTimeout(() => { if (ws.readyState === ws.OPEN) ws.close(); }, upgradeTimeout);
		});

		this.publicUrl = `ws://${domain}:${port}`;
	}
	getPublicIdCard() {
		return { id: this.id, publicUrl: this.publicUrl };
	}
	// NETWORK CONSISTENCY
	async #enhanceConnectionLoop(delay = VARS.ENHANCE_CONNECTION_DELAY) {
		let nBI = 0; // nextBootstrapIndex
		while (true) {
			const connectedPeersCount = Object.keys(this.peerStore.peers.connected).length;
			if (connectedPeersCount < this.opts.targetNeighbors / 2) nBI = this.#tryConnectNextBootstrap(nBI);

			//if (this.id === 'peer_0') {
			const targets = this.#pickPeerIds(this.opts.targetNeighbors - connectedPeersCount);
			for (const targetId of targets) if (Math.random() < .3) this.peerStore.addConnectingPeer(targetId);
			//}

			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}
	#tryConnectNextBootstrap(nextBootstrapIndex) {
		if (this.bootstraps.length === 0) return;
		const { id, publicUrl } = this.bootstraps[nextBootstrapIndex];
		const canMakeATry = id && publicUrl && !this.peerStore.peers.connected[id];
		if (canMakeATry) this.#connectToPublicNode_UsingWs_UntilWebRtcUpgrade(id, publicUrl);
		return (nextBootstrapIndex + 1) % this.bootstraps.length;
	}
	#connectToPublicNode_UsingWs_UntilWebRtcUpgrade(remoteId = 'toto', publicNodeUrl = 'localhost:8080') {
		const ws = new WebSocket(publicNodeUrl);
		ws.onopen = () => this.peerStore.addConnectingPeer(remoteId, ws);
		ws.onmessage = (event) => {
			const parsedMessage = JSON.parse(event.data);
			if (parsedMessage.type === 'signal') this.#handleIncomingSignal(remoteId, parsedMessage.data);
		};
		ws.onclose = () => this.peerStore.removeConnectingPeer(remoteId);
		ws.onerror = (error) => console.error(`WebSocket error:`, error);
		return ws;
	}
	#pickPeerIds(count = 1, maxNeighbours = 10) {
		const selectedPeers = [];
		//for (const [peerId, peerInfo] of Object.entries(this.peerStore.peers.known))
		const shuffledKeys = shuffleArray(Object.keys(this.peerStore.peers.known));
		for (const peerId of shuffledKeys) {
			const peerInfo = this.peerStore.peers.known[peerId];
			if (selectedPeers.length >= count) break;
			else if (peerId === this.id) continue; // skip self
			else if (this.peerStore.peers.connecting[peerId]) continue; // skip connecting peers
			else if (this.peerStore.peers.connected[peerId]) continue; // skip already connected peers
			else if (peerInfo.connectionsCount <= maxNeighbours) selectedPeers.push(peerId);
		}

		return selectedPeers;
	}
	// MESSAGE SENDING
	/** @param {string} remoteId @param {string | Uint8Array} data @param {WebSocket} [ws] optional WebSocket */
	sendMessage(remoteId, type, data, ws, spread = 1) {
		if (ws && ws.readyState === WebSocket.OPEN) { // special case for initial ws connection (type: signal)
			ws.send(JSON.stringify(new DirectMessage([this.id, remoteId], type, data))); return; }

		const pathFinder = new RouteBuilder(this.id, this.peerStore.peers.known, this.peerStore.peers.connected);
		const routes = pathFinder.buildRoutes(this.id, remoteId);
		if (!routes.success) return;

		for (let i = 0; i < Math.min(spread, routes.routes.length); i++) {
			const msg = new DirectMessage(routes.routes[i].path, type, data);
			this.peerStore.sendMessageToPeer(msg.route[1], msg); // send to next peer
		}
	}
	/** @param {string} from @param {DirectMessage} message */
	#handleDirectMessage(from, message, log = false) {
		const { route, type, data, isFlexible } = message;
		const myIdPosition = route.indexOf(this.id);
		if (myIdPosition === -1) return console.warn(`Direct message from ${from} to ${this.id} is not routed correctly. Route:`, route);

		const [senderId, prevId, nextId] = [route[0], route[myIdPosition - 1], route[myIdPosition + 1]];
		if (senderId === this.id) return console.warn(`Direct message from self (${this.id}) is not allowed.`);
		if (from !== prevId) return console.warn(`Direct message from ${from} to ${this.id} is not routed correctly. Expected previous ID: ${prevId}, but got: ${from}`);
		if (myIdPosition !== route.length - 1) return this.peerStore.sendMessageToPeer(nextId, message); // forward to next
		
		// This node is the target of the message
		if (log) {
			if (senderId === from) console.log(`(${this.id}) Direct message received from ${senderId}: ${data}`);
			else console.log(`(${this.id}) Direct message received from ${senderId} (lastRelay: ${from}): ${data}`);
		}

		this.peerStore.digestValidRoute(route); // peer discovery by the way
		if (type === 'signal') this.#handleIncomingSignal(senderId, data);
	}
	/** @param {string} senderId @param {string} data @param {WebSocket} [ws] optional WebSocket */
	#handleIncomingSignal(senderId, data, ws) {
		const conn = this.peerStore.peers.connecting[senderId];
		if (!conn && data.type === 'offer') this.peerStore.addConnectingPeer(senderId, ws, data);
		else if (conn && data.type !== 'offer') this.peerStore.assignConnectingPeerSignal(senderId, data);
	}

	/** @param {string} topic @param {string | Uint8Array} data @param {number} [TTL] */
	broadcast(topic, data, TTL = 3) {
		const message = new GossipMessage(this.id, topic, data, TTL);
		for (const peerId in this.peerStore.peers.connected) this.peerStore.sendMessageToPeer(peerId, message);
	}
	/** @param {string} from @param {GossipMessage} message */
	#handleGossipMessage(from, message) {
		const { senderId, topic, data, TTL } = message;
		//if (from === senderId) console.log(`(${this.id}) Gossip message received from ${senderId} on topic ${topic}:`, data);
		//else console.log(`(${this.id}) Gossip message received from ${senderId} (lastRelay: ${from}) on topic ${topic}:`, data);

		for (const handler of Object.values(this.gossipHandlers[topic] || {})) handler(senderId, data);

		if (TTL < 1) return; // stop forwarding if TTL is 0
		if (this.id === senderId) return; // avoid sending our own message again
		for (const [peerId, conn] of Object.entries(this.peerStore.peers.connected)) {
			if (peerId === from) continue; // avoid sending back to sender
			if (Math.random() > this.opts.gossipTransmissionRate) continue; // apply gossip transmission rate
			conn.simplePeerInstance.send(JSON.stringify(new GossipMessage(senderId, topic, data, TTL - 1)));
		}
	}
}

export function createNodeP2P(id = 'toto', bootstraps = []) {
	return new NodeP2P(id, bootstraps);
}
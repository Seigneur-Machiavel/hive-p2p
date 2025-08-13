import { PeerStore } from './peer.mjs';
import { Gossip } from './p2p_gossip.mjs';
import { VARS, shuffleArray } from './p2p_utils.mjs';
import { WebSocketServer } from 'ws';
import { TestWsServer, TestWsConnection } from './p2p_test_transport.mjs';
import { RouteBuilder } from './path_finder.mjs';
import { DirectMessage } from './p2p_message.mjs'; // DEPRECATING

// caught Exceptions, add handler for

const BOOTSTRAP_TRANSPORTS = {
	/** @type {Record<string, WebSocketServer>} */
	server: {
		'WebSocket': WebSocketServer,
		'Test': TestWsServer
	},
	/** @type {Record<string, WebSocket>} */
	client: {
		'WebSocket': WebSocket,
		'Test': TestWsConnection
	}
}

export class NodeP2P {
	verbose;
	/** @type {string | undefined} WebSocket URL (public node only) */
	publicUrl;
	maxPublicWsConnections = 10;

	id; // should be based on crypto
	peerStore;
	gossip;
	transportName;
	useTestBootstrapTransport = false; // if true, use TestWs for bootstrap connections
	bootstraps; nBI = 0; // nBI: next Bootstrap Index
	connexionEnhancer1;
	connexionEnhancer2;

	/** @param {string} id The unique identifier for the node
	 * @param {Array<string>} bootstraps List of bootstrap nodes used as P2P network entry
	 * @param {'SimplePeer' | 'Test'} transport The transport protocol to use */
	constructor(id = 'toto', bootstraps = [], transport = 'SimplePeer', init = true, verbose = 0) {
		this.verbose = verbose;
		this.id = id;
		this.peerStore = new PeerStore(id);
		this.gossip = new Gossip(id, this.peerStore);
		this.bootstraps = shuffleArray(bootstraps);
		this.transportName = transport;
		this.useTestBootstrapTransport = transport === 'Test';

		this.peerStore.onSignal.unshift((peerId, data) => this.sendMessage(peerId, 'signal', data));
		this.peerStore.onConnect.unshift((peerId, direction) => {
			if (this.peerStore.isBanned(peerId)) { this.peerStore.banPeer(peerId, 60_000); return; } // ban again
			if (verbose > 0) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection established with peer ${peerId}`);
			if (direction === 'in') setTimeout(() => this.broadcast('peer_connected', peerId, 3), 1000); // TODO chose best delay
		});
		this.peerStore.onDisconnect.unshift((peerId, direction) => {
			if (verbose > 1) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection closed with peer ${peerId}`);
			this.peerStore.unlinkPeers(this.id, peerId);
			setTimeout(() => this.broadcast('peer_disconnected', peerId, 3), 1000);
		});
		this.peerStore.onData.unshift((peerId, data) => {
			const deserialized = JSON.parse(data);
			if (deserialized.route) this.#handleDirectMessage(peerId, deserialized);
			else this.gossip.handleGossipMessage(peerId, deserialized, data, this.verbose);
		});

		if (verbose > 0) console.log(`NodeP2P initialized: ${id}`);
		this.#tryConnectNextBootstrap(); // first shot ASAP
		const ecd = VARS.ENHANCE_CONNECTION_DELAY;
		this.connexionEnhancer1 = setInterval(() => this.#tryConnectNextBootstrap(), ecd);
		setInterval(() => this.connexionEnhancer2 = setInterval(() => this.#tryConnectMoreNodes(), ecd), 1000);
	}

	// API
	/** @param {string} topic @param {string | Uint8Array} data @param {number} [TTL] */
	broadcast(topic, data, TTL = VARS.GOSSIP_DEFAULT_TTL) { this.gossip.broadcast(topic, data, TTL); }
	tryConnectToPeer(targetId = 'toto') { this.peerStore.addConnectingPeer(targetId, undefined, undefined, this.transportName); }

	// PUBLIC (BOOTSTRAP)
	setAsPublic(domain = 'localhost', port = VARS.SERVICE_NODE_PORT, upgradeTimeout = VARS.CONNECTION_UPGRADE_TIMEOUT * 2) {
		// public node kick peer after 1min and ban it for 1min to improve network consistency
		this.peerStore.onConnect.unshift((peerId, direction) =>
			direction === 'in' ? setTimeout(() => this.peerStore.banPeer(peerId, 30_000), 30_000) : null);
		// create simple ws server to accept incoming connections (Require to open port)
		this.publicUrl = `ws://${domain}:${port}`;
		const Transport = BOOTSTRAP_TRANSPORTS.server[this.useTestBootstrapTransport ? 'Test' : 'WebSocket'];
		this.wsServer = new Transport({ port, host: domain });
		this.wsServer.on('error', (error) => console.error(`WebSocket error on Node #${this.id}:`, error));
		this.wsServer.on('connection', (ws) => {
			if (this.wsServer.clients.size > this.maxPublicWsConnections) ws.close();

			let remoteId;
			ws.on('message', (message) => {
				try {
					const parsedMessage = JSON.parse(message);
					if (parsedMessage.route.length !== 2) return console.error('Received message does not have a valid route');
					if (parsedMessage.route[1] !== this.id) return console.error(`Received message is not for this node (expected: ${this.id}, got: ${parsedMessage.route[1]})`);
					if (parsedMessage.type !== 'signal') return console.error(`Received message is not a signal (type: ${parsedMessage.type})`);
					if (!remoteId) remoteId = parsedMessage.route[0];
					// if banned, simply ignore but don't announce/close, we can't be sure of the remoteId!
					if (this.peerStore.isBanned(remoteId)) return;
					this.#handleIncomingSignal(remoteId, parsedMessage.data, ws);
				} catch (error) { if (this.verbose > 1) console.error(`Error handling incoming signal for ${remoteId}:`, error.stack); }
			});
			ws.on('close', () => remoteId ? this.peerStore.removePeer(remoteId, 'connecting') : null);
			setTimeout(() => ws.readyState === ws.OPEN ? ws.close() : null, upgradeTimeout);
		});
	}
	getPublicIdCard() {
		return { id: this.id, publicUrl: this.publicUrl };
	}
	// NETWORK MANAGEMENT
	#tryConnectNextBootstrap(nextBootstrapIndex) {
		if (this.bootstraps.length === 0) return;
		const connectedPeersCount = Object.keys(this.peerStore.store.connected).length;
		const { id, publicUrl } = this.bootstraps[this.nBI];
		const canMakeATry = id && publicUrl && !this.peerStore.store.connected[id] && !this.peerStore.store.connecting[id];
		if (canMakeATry) this.#connectToPublicNode_UsingWs_UntilWebRtcUpgrade(id, publicUrl);
		this.nBI = (this.nBI + 1) % this.bootstraps.length;
		//return (nextBootstrapIndex + 1) % this.bootstraps.length;
	}
	#connectToPublicNode_UsingWs_UntilWebRtcUpgrade(remoteId = 'toto', publicNodeUrl = 'localhost:8080') {
		const Transport = BOOTSTRAP_TRANSPORTS.client[this.useTestBootstrapTransport ? 'Test' : 'WebSocket'];
		const ws = new Transport(publicNodeUrl);
		ws.onopen = () => this.peerStore.addConnectingPeer(remoteId, ws, undefined, this.transportName);
		ws.onmessage = (event) => {
			try {
				const parsed = JSON.parse(event.data);
				if (parsed.type !== 'signal') return console.error(`Received message is not a signal (type: ${parsed.type})`);
				this.#handleIncomingSignal(remoteId, parsed.data);
			} catch (error) { console.error(`Error handling incoming signal for ${remoteId}:`, error); }
		}
		ws.onclose = () => this.peerStore.removePeer(remoteId, 'connecting');
		ws.onerror = (error) => console.error(`WebSocket error:`, error.stack);
		return ws;
	}
	#tryConnectMoreNodes(ignoreBannedPeers = true) {
		const connectedPeersCount = Object.keys(this.peerStore.store.connected).length;
		const maxTargets = (VARS.TARGET_NEIGHBORS - connectedPeersCount);
		const targets = [];
		//for (const [peerId, peerInfo] of Object.entries(this.peerStore.store.known))
		const shuffledKeys = shuffleArray(Object.keys(this.peerStore.store.known));
		for (const peerId of shuffledKeys) {
			if (ignoreBannedPeers && this.peerStore.isBanned(peerId)) continue;
			const peerInfo = this.peerStore.store.known[peerId];
			if (targets.length >= maxTargets) break;
			else if (peerId === this.id) continue; // skip self
			else if (this.peerStore.store.connecting[peerId]) continue; // skip connecting peers
			else if (this.peerStore.store.connected[peerId]) continue; // skip already connected peers
			else if (peerInfo.connectionsCount <= VARS.TARGET_NEIGHBORS) targets.push(peerId);
		}

		for (const targetId of targets) if (Math.random() < VARS.ENHANCE_CONNECTION_RATE) this.tryConnectToPeer(targetId);
	}
	// DIRECT MESSAGING
	/** @param {string} remoteId @param {string | Uint8Array} data */
	sendMessage(remoteId, type, data, spread = 1) {
		const tempConActive = this.peerStore.store.connecting[remoteId]?.tempTransportInstance?.readyState === 1;
		if (tempConActive && type !== 'signal') return; // 'signal' message only on temporary connections
		const pathFinder = new RouteBuilder(this.id, this.peerStore.store.known, this.peerStore.store.connected);
		const builtResult = tempConActive
			? { success: true, routes: [{ path: [this.id, remoteId] }] }
			: pathFinder.buildRoutes(this.id, remoteId);
		if (!builtResult.success) return { success: false, reason: 'No route found' };

		for (let i = 0; i < Math.min(spread, builtResult.routes.length); i++) {
			const msg = new DirectMessage(builtResult.routes[i].path, type, data);
			this.peerStore.sendMessageToPeer(msg.route[1], msg); // send to next peer
		}
		return { success: true, routes: builtResult.routes };
	}
	/** @param {string} from @param {DirectMessage} message */
	#handleDirectMessage(from, message, log = false) {
		if (this.peerStore.isBanned(from)) return;
		const { route, type, data, isFlexible } = message;
		const myIdPosition = route.indexOf(this.id);
		if (myIdPosition === -1) return console.warn(`Direct message from ${from} to ${this.id} is not routed correctly. Route:`, route);

		const [senderId, prevId, nextId] = [route[0], route[myIdPosition - 1], route[myIdPosition + 1]];
		if (senderId === this.id) return console.warn(`Direct message from self (${this.id}) is not allowed.`);
		if (from !== prevId) return console.warn(`Direct message from ${from} to ${this.id} is not routed correctly. Expected previous ID: ${prevId}, but got: ${from}`);
		if (myIdPosition !== route.length - 1) return this.peerStore.sendMessageToPeer(nextId, message); // forward to next
		// ... or this node is the target of the message
		
		if (log) {
			if (senderId === from) console.log(`(${this.id}) Direct message received from ${senderId}: ${data}`);
			else console.log(`(${this.id}) Direct message received from ${senderId} (lastRelay: ${from}): ${data}`);
		}

		this.peerStore.digestValidRoute(route); // peer discovery by the way
		if (type === 'signal') this.#handleIncomingSignal(senderId, data);
	}
	/** @param {string} senderId @param {object} data @param {WebSocket} [tempTransportInstance] optional WebSocket */
	#handleIncomingSignal(senderId, data, tempTransportInstance) {
		if (!senderId || typeof data !== 'object') return;
		const conn = this.peerStore.store.connecting[senderId];
		if (!conn && data.type === 'offer') this.peerStore.addConnectingPeer(senderId, tempTransportInstance, data, this.transportName);
		else if (conn && data.type !== 'offer') this.peerStore.assignConnectingPeerSignal(senderId, data);
	}

	destroy() {
		this.peerStore.destroy();
		this.gossip.destroy();
		if (this.wsServer) this.wsServer.close();
		if (this.connexionEnhancer1) clearInterval(this.connexionEnhancer1);
		if (this.connexionEnhancer2) clearInterval(this.connexionEnhancer2);
	}
}

/** @param {string} id @param {Array<string>} bootstraps @param {'SimplePeer' | 'Test'} transport */
export function createNodeP2P(id = 'toto', bootstraps = [], transport = 'Test') {
	return new NodeP2P(id, bootstraps, transport);
}
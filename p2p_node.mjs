import { PeerStore } from './peer.mjs';
import { Messager } from './p2p_direct.mjs';
import { Gossip } from './p2p_gossip.mjs';
import { VARS, shuffleArray } from './p2p_utils.mjs';
import { WebSocketServer } from 'ws';
import { TestWsServer, TestWsConnection } from './p2p_test_transport.mjs';

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
	messager;
	gossip;
	transportName;
	useTestBootstrapTransport = false; // if true, use TestWs for bootstrap connections
	bootstraps; nBI = 0; // nBI: next Bootstrap Index
	connexionEnhancer1;
	connexionEnhancer2;

	/** @type {Record<string, Record<string, Function>>} */
	callbacks = { // NOT USED FOR NOW BUT SHOULD BE RELATED TO THE NODE API FOR CONSISTENCY
		onDirectMessage: [],
		onGossipMessage: []
	};

	/** @param {string} id The unique identifier for the node
	 * @param {Array<string>} bootstraps List of bootstrap nodes used as P2P network entry
	 * @param {'SimplePeer' | 'Test'} transport The transport protocol to use */
	constructor(id = 'toto', bootstraps = [], transport = 'SimplePeer', verbose = 0) {
		this.verbose = verbose;
		this.id = id;
		this.peerStore = new PeerStore(id);
		this.messager = new Messager(id, this.peerStore);
		this.gossip = new Gossip(id, this.peerStore);
		//this.bootstraps = shuffleArray(bootstraps);
		this.bootstraps = bootstraps;
		this.nBI = Math.random() * bootstraps.length | 0;
		this.transportName = transport;
		this.useTestBootstrapTransport = transport === 'Test';

		this.messager.on('signal', (senderId, data) => this.#handleIncomingSignal(senderId, data));
		this.peerStore.on('signal', (peerId, data) => this.sendMessage(peerId, 'signal', data));
		this.peerStore.on('connect', (peerId, direction) => {
			if (this.peerStore.isBanned(peerId)) { this.peerStore.banPeer(peerId, 60_000); return; } // ban again
			if (verbose) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection established with peer ${peerId}`);
			if (direction === 'in') setTimeout(() => this.broadcast('peer_connected', peerId), 500); // TODO chose best delay
		});
		this.peerStore.on('disconnect', (peerId, direction) => {
			if (verbose) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection closed with peer ${peerId}`);
			this.peerStore.unlinkPeers(this.id, peerId);
			setTimeout(() => this.broadcast('peer_disconnected', peerId), 500); // TODO chose best delay
		});
		this.peerStore.on('data', (peerId, data) => {
			const deserialized = JSON.parse(data);
			if (deserialized.route) this.messager.handleDirectMessage(peerId, deserialized, this.verbose);
			else this.gossip.handleGossipMessage(peerId, deserialized, data, this.verbose);
		});

		if (verbose > 0) console.log(`NodeP2P initialized: ${id}`);
	}
	
	// API
	/** @param {string} id @param {Array<string>} bootstraps @param {'SimplePeer' | 'Test'} transport */
	static createNode(id = 'toto', bootstraps = [], transport = 'Test', init = true) {
		const node = new NodeP2P(id, bootstraps, transport);
		if (init) node.init();
		return node;
	}
	init() {
		this.#tryConnectNextBootstrap(); // first shot ASAP
		const ecd = VARS.ENHANCE_CONNECTION_DELAY;
		this.connexionEnhancer1 = setInterval(() => this.#tryConnectNextBootstrap(), ecd);
		setTimeout(() => this.connexionEnhancer2 = setInterval(() => this.#tryConnectMoreNodes(), ecd), 1000);
		return true;
	}
	/** @param {string} topic @param {string | Uint8Array} data @param {number} [TTL] */
	broadcast(topic, data, TTL = VARS.GOSSIP_DEFAULT_TTL) { this.gossip.broadcast(topic, data, TTL); }
	/** @param {string} remoteId @param {string | Uint8Array} data */
	sendMessage(remoteId, type, data, spread = 1) { this.messager.sendMessage(remoteId, type, data, spread); }
	tryConnectToPeer(targetId = 'toto') { this.peerStore.addConnectingPeer(targetId, undefined, undefined, this.transportName); }
	destroy() {
		this.peerStore.destroy();
		this.gossip.destroy();
		if (this.wsServer) this.wsServer.close();
		if (this.connexionEnhancer1) clearInterval(this.connexionEnhancer1);
		if (this.connexionEnhancer2) clearInterval(this.connexionEnhancer2);
	}

	// BOOTSTRAP METHODS
	setAsPublic(domain = 'localhost', port = VARS.SERVICE_NODE_PORT, upgradeTimeout = VARS.CONNECTION_UPGRADE_TIMEOUT * 2) {
		// public node kick peer after 1min and ban it for 1min to improve network consistency
		const [banDelays, banDuration] = [VARS.PUBLIC_NODE_AUTO_BAN_DELAY, VARS.PUBLIC_NODE_AUTO_BAN_DURATION];
		this.peerStore.on('connect', (peerId, direction) =>{
			const banDelay = Math.random() * (banDelays.max - banDelays.min) + banDelays.min;
			if (direction === 'in') setTimeout(() => this.peerStore.banPeer(peerId, banDuration), banDelay);
		});
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

		return { id: this.id, publicUrl: this.publicUrl };
	}
	// NETWORK MANAGEMENT
	#tryConnectNextBootstrap() {
		if (this.bootstraps.length === 0) return;
		const connectedPeersCount = Object.keys(this.peerStore.store.connected).length;
		const { id, publicUrl } = this.bootstraps[this.nBI];
		const canMakeATry = id && publicUrl && !this.peerStore.store.connected[id] && !this.peerStore.store.connecting[id];
		if (canMakeATry) this.#connectToPublicNode_UsingWs_UntilWebRtcUpgrade(id, publicUrl);
		this.nBI = (this.nBI + 1) % this.bootstraps.length;
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
		for (const peerId of shuffleArray(Object.keys(this.peerStore.store.known))) {
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
	/** @param {string} senderId @param {object} data @param {WebSocket} [tempTransportInstance] optional WebSocket */
	#handleIncomingSignal(senderId, data, tempTransportInstance) {
		if (!senderId || typeof data !== 'object') return;
		const conn = this.peerStore.store.connecting[senderId];
		if (conn && data.type !== 'offer') this.peerStore.assignConnectingPeerSignal(senderId, data);
		else if (!conn && data.type === 'offer') {
			const sharedNeighbours = this.peerStore.sharedNeighbours(this.id, senderId);
			// if shared neighbours => avoid connection
			if (sharedNeighbours.length > 2) this.peerStore.banPeer(senderId, 30_000);
			else this.peerStore.addConnectingPeer(senderId, tempTransportInstance, data, this.transportName);
		}
	}
}
import { WebSocketServer } from 'ws';
import { TestWsServer } from '../simulation/test-transports.mjs';
import { PeerStore } from './peer-store.mjs';
import { NetworkEnhancer } from './network-enhancer.mjs';
import { UnicastMessager } from './unicast.mjs';
import { Gossip } from './gossip.mjs';
import { NODE } from '../utils/p2p_params.mjs';

export class NodeP2P {
	verbose;
	/** @type {string | undefined} WebSocket URL (public node only) */ publicUrl;
	/** should be based on crypto */ id;
	/** class managing network connections */ peerStore;
	/** class managing network connections */ networkEnhancer;
	/** class who manage direct messages */ messager;
	/** class who manage gossip messages */ gossip;
	/** flag to indicate whether to use test transport */ useTestTransport;

	/** @type {Record<string, Record<string, Function>>} */
	callbacks = { // NOT USED FOR NOW BUT SHOULD BE RELATED TO THE NODE API FOR CONSISTENCY
		onDirectMessage: [],
		onGossipMessage: []
	};

	/** @param {string} id The unique identifier for the node
	 * @param {Array<Record<string, string>>} bootstraps List of bootstrap nodes used as P2P network entry
	 * @param {boolean} useTestTransport Whether to use the test transport */
	constructor(id = 'toto', bootstraps = [], useTestTransport = false, verbose = 0) {
		this.verbose = verbose;
		this.id = id;
		this.peerStore = new PeerStore(NODE.CONNECTION_UPGRADE_TIMEOUT);
		this.networkEnhancer = new NetworkEnhancer(id, this.peerStore, bootstraps, useTestTransport);
		this.messager = new UnicastMessager(id, this.peerStore);
		this.gossip = new Gossip(id, this.peerStore);
		this.useTestTransport = useTestTransport;

		// SETUP LISTENERS
		this.peerStore.on('signal', (peerId, data) => this.sendMessage(peerId, 'signal', data));
		this.peerStore.on('connect', (peerId, direction) => this.#onConnect(peerId, direction));
		this.peerStore.on('disconnect', (peerId, direction) => this.#onDisconnect(peerId, direction));
		this.peerStore.on('data', (peerId, data) => this.#onData(peerId, data));
		this.messager.on('signal', (senderId, data) => this.networkEnhancer.handleIncomingSignal(senderId, data));
		this.messager.on('gossip_history', (senderId, messages) => this.networkEnhancer.handleIncomingGossipHistory(senderId, messages));

		if (verbose > 0) console.log(`NodeP2P initialized: ${id}`);
	}

	// PRIVATE METHODS
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#onConnect = (peerId, direction) => {
		if (this.peerStore.isKicked(peerId)) return;
		if (this.verbose) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection established with peer ${peerId}`);
		this.peerStore.linkPeers(this.id, peerId); // Add link in self store
		
		setTimeout(() => {
			this.broadcast('peer_connected', peerId); // Spread the info
			const gossipHistory = this.gossip.bloomFilter.getGossipHistoryByTime();
			this.messager.sendMessage(peerId, 'gossip_history', gossipHistory);
			//for (const msg of messagesHistory) this.gossip.broadcastToPeer(peerId, msg.senderId, msg.topic, msg.data);
		}, 500); // send recent messages after 0.5s
	}
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#onDisconnect = (peerId, direction) => {
		if (this.verbose) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection closed with peer ${peerId}`);
		const connDuration = this.peerStore.connected[peerId]?.getConnectionDuration() || 0;
		this.peerStore.unlinkPeers(this.id, peerId);
		if (connDuration < NODE.MIN_CONNECTION_TIME_TO_DISPATCH_EVENT) return;
		setTimeout(() => this.broadcast('peer_disconnected', peerId), 600); // Spread the info
	}
	#onData = (peerId, data) => {
		const deserialized = JSON.parse(data);
		if (deserialized.route) this.messager.handleDirectMessage(peerId, deserialized, this.verbose);
		else this.gossip.handleGossipMessage(peerId, deserialized, data, this.verbose);
	}

	// PUBLIC API
	/** @param {string} id @param {Array<string>} bootstraps @param {'SimplePeer' | 'Test'} transport */
	static createNode(id = 'toto', bootstraps = [], transport = 'Test', init = true) {
		const node = new NodeP2P(id, bootstraps, transport);
		if (init) node.init();
		return node;
	}
	init() { this.networkEnhancer.init(); return true; }
	/** @param {string} topic @param {string | Uint8Array} data @param {number} [TTL] */
	broadcast(topic, data, TTL) { this.gossip.broadcast(topic, data, TTL); }
	/** @param {string} remoteId @param {string | Uint8Array} data */
	sendMessage(remoteId, type, data, spread = 1) { this.messager.sendMessage(remoteId, type, data, spread); }
	tryConnectToPeer(targetId = 'toto') { this.peerStore.addConnectingPeer(targetId, undefined, undefined, this.useTestTransport); }
	setAsPublic(domain = 'localhost', port = NODE.SERVICE_PORT) {
		// public node kick peer after 1min and ban it for 1min to improve network consistency
		const [banDelays, banDuration] = [NODE.PUBLIC_AUTO_BAN_DELAY, NODE.PUBLIC_AUTO_BAN_DURATION];
		this.peerStore.on('connect', (peerId, direction) => {
			const banDelay = Math.random() * (banDelays.max - banDelays.min) + banDelays.min;
			if (direction === 'in') setTimeout(() => this.peerStore.kickPeer(peerId, banDuration), banDelay);
		});
		// create simple ws server to accept incoming connections (Require to open port)
		this.publicUrl = `ws://${domain}:${port}`;
		const Transport = this.useTestTransport ? TestWsServer : WebSocketServer;
		this.wsServer = new Transport({ port, host: domain });
		this.wsServer.on('error', (error) => console.error(`WebSocket error on Node #${this.id}:`, error));
		this.wsServer.on('connection', (ws) => {
			if (this.wsServer.clients.size > NODE.MAX_BOOTSTRAPS_IN_CONNS) ws.close();

			let remoteId;
			ws.on('message', (message) => {
				try {
					// TODO: move test in a dedicated file
					const parsedMessage = JSON.parse(message);
					if (parsedMessage.route.length !== 2) return (this.verbose) ? console.info('Received message does not have a valid route') : null;
					if (parsedMessage.route[1] !== this.id) return (this.verbose) ? console.info(`Received message is not for this node (expected: ${this.id}, got: ${parsedMessage.route[1]})`) : null;
					if (parsedMessage.type !== 'signal') return (this.verbose) ? console.info(`Received message is not a signal (type: ${parsedMessage.type})`) : null;
					if (!remoteId) remoteId = parsedMessage.route[0];
					// if kicked, simply ignore but don't announce/close, we can't be sure of the remoteId!
					if (this.peerStore.isKicked(remoteId)) return;
					this.networkEnhancer.handleIncomingSignal(remoteId, parsedMessage.data, ws);
				} catch (error) { if (this.verbose > 1) console.error(`Error handling incoming signal for ${remoteId}:`, error.stack); }
			});
			ws.on('close', () => remoteId ? this.peerStore.removePeer(remoteId, 'connecting') : null);
			setTimeout(() => ws.readyState === ws.OPEN ? ws.close() : null, NODE.CONNECTION_UPGRADE_TIMEOUT * 2);
		});

		return { id: this.id, publicUrl: this.publicUrl };
	}
	destroy() {
		this.peerStore.destroy();
		this.networkEnhancer.destroy();
		if (this.wsServer) this.wsServer.close();
	}
}
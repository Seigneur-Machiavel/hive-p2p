import { CLOCK, SIMULATION, NODE, TRANSPORTS, DISCOVERY } from './global_parameters.mjs';
import { SdpOfferManager } from './peer-store-managers.mjs';
import { PeerStore } from './peer-store.mjs';
import { UnicastMessager } from './unicast.mjs';
import { Gossip } from './gossip.mjs';
import { NetworkEnhancer } from './network-enhancer.mjs';
import { CryptoCodex } from './crypto-codex.mjs';
import { NodeServices } from './public-upgrader.mjs';

export class NodeP2P {
	started = false;
	verbose;
	cryptoCodex;
	/** should be based on crypto */ id;
	/** class managing network connections */ peerStore;
	/** class who manage direct messages */ messager;
	/** class who manage gossip messages */ gossip;
	/** class managing network */ networkEnhancer;
	/** @type {NodeServices | undefined} */ nodeServices;

	/** Initialize a new P2P node instance, use .start() to init networkEnhancer
	 * @param {CryptoCodex} cryptoCodex - Identity of the node.
	 * @param {Array<Record<string, string>>} bootstraps List of bootstrap nodes used as P2P network entry */
	constructor(cryptoCodex, bootstraps = [], verbose = NODE.DEFAULT_VERBOSE) {
		this.verbose = verbose;
		this.cryptoCodex = cryptoCodex;
		this.id = this.cryptoCodex.id;
		const sdpOfferManager = new SdpOfferManager(this.id, bootstraps, verbose);
		this.peerStore = new PeerStore(this.id, this.cryptoCodex, sdpOfferManager, verbose);
		this.messager = new UnicastMessager(this.id, this.cryptoCodex, this.peerStore, verbose);
		this.gossip = new Gossip(this.id, this.cryptoCodex, this.peerStore, verbose);
		this.networkEnhancer = new NetworkEnhancer(this.id, this.gossip, this.messager, this.peerStore, bootstraps);
		const { peerStore, messager, gossip, networkEnhancer } = this;

		// SETUP TRANSPORTS LISTENERS
		peerStore.on('signal', (peerId, data) => this.sendMessage(peerId, data, 'signal_answer')); // answer created => send it to offerer
		peerStore.on('connect', (peerId, direction) => this.#onConnect(peerId, direction));
		peerStore.on('disconnect', (peerId, direction) => this.#onDisconnect(peerId, direction));
		peerStore.on('data', (peerId, data) => this.#onData(peerId, data));
		
		// UNICAST LISTENERS
		messager.on('signal_answer', (senderId, data) => networkEnhancer.handleIncomingSignal(senderId, data));
		messager.on('signal_offer', (senderId, data) => networkEnhancer.handleIncomingSignal(senderId, data));

		// GOSSIP LISTENERS
		gossip.on('signal_offer', (senderId, data, HOPS) => networkEnhancer.handleIncomingSignal(senderId, data, HOPS));

		if (verbose > 2) console.log(`NodeP2P initialized: ${this.id}`);
	}

	// PRIVATE METHODS
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#onConnect = (peerId, direction) => {
		const remoteIsPublic = this.cryptoCodex.isPublicNode(peerId);
		if (this.publicUrl) return; // public node do not need to do anything special on connect
		if (this.verbose > ((this.publicUrl || remoteIsPublic) ? 3 : 2)) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection established with peer ${peerId}`);
		
		const dispatchEvents = () => {
			const isHandshakeInitiator = remoteIsPublic || direction === 'in';
			if (isHandshakeInitiator) this.sendMessage(peerId, this.id, 'handshake');
			if (DISCOVERY.ON_CONNECT_DISPATCH.SHARE_HISTORY) 
				if (this.peerStore.known[peerId]?.connectionsCount <= 1) this.gossip.sendGossipHistoryToPeer(peerId);
		};
		if (!DISCOVERY.ON_CONNECT_DISPATCH.DELAY) dispatchEvents();
		else setTimeout(dispatchEvents, DISCOVERY.ON_CONNECT_DISPATCH.DELAY);
	}
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#onDisconnect = (peerId, direction) => {
		const remoteIsPublic = this.cryptoCodex.isPublicNode(peerId);
		const connDuration = this.peerStore.connected[peerId]?.getConnectionDuration() || 0;
		if (connDuration < DISCOVERY.ON_DISCONNECT_DISPATCH.MIN_CONNECTION_TIME) return;
		if (this.peerStore.connected[peerId]) return; // still connected, ignore disconnection for now ?
		if (this.verbose > ((this.publicUrl || remoteIsPublic) ? 3 : 2)) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection closed with peer ${peerId}`);
		
		const dispatchEvents = () => {
		};
		if (!DISCOVERY.ON_DISCONNECT_DISPATCH.DELAY) dispatchEvents();
		else setTimeout(dispatchEvents, DISCOVERY.ON_DISCONNECT_DISPATCH.DELAY);
	}
	#onData = (peerId, data) => {
		const d = new Uint8Array(data);
		if (d[0] > 127) this.gossip.handleGossipMessage(peerId, d);
		else this.messager.handleDirectMessage(peerId, d);
	}

	// PUBLIC API
	get publicUrl() { return this.nodeServices?.publicUrl; }

	/** @param {Array<string>} bootstraps @param {CryptoCodex} [cryptoCodex] - Identity of the node; if not provided, a new one will be generated @param {boolean} [start] default: false @param {string} [domain] public node only, ex: 'localhost' @param {number} [port] public node only, ex: 8080 */
	static createNode(bootstraps, cryptoCodex, start = true, domain, port = NODE.SERVICE.PORT, verbose = NODE.DEFAULT_VERBOSE) {
		const codex = cryptoCodex || new CryptoCodex();
		if (!codex.publicKey) codex.generate(domain ? true : false);

		const node = new NodeP2P(codex, bootstraps, verbose);
		if (domain) {
			node.nodeServices = new NodeServices(codex, node.peerStore, undefined, verbose);
			node.nodeServices.start(domain, port);
			node.networkEnhancer.nodeServices = node.nodeServices;
		}
		if (start) node.start();
		return node;
	}
	start() {
		CLOCK.sync(this.verbose).then(() => {
			this.started = true;
			if (SIMULATION.AVOID_INTERVALS) return true; // SIMULATOR CASE
			this.networkEnhancer.tryConnectNextBootstrap(); // first shot ASAP
			this.enhancerInterval = setInterval(() => this.networkEnhancer.autoEnhancementTick(), DISCOVERY.LOOP_DELAY);
			this.peerStoreInterval = setInterval(() => { this.peerStore.cleanupExpired(); this.peerStore.sdpOfferManager.tick(); }, 2500);
		});
		return true;
	}
	/** Broadcast a message to all connected peers or to a specified peer
	 * @param {string | Uint8Array | Object} data @param {string} topic  @param {string} [targetId] default: broadcast to all
	 * @param {number} [timestamp] default: CLOCK.time @param {number} [HOPS] default: GOSSIP.HOPS[topic] || GOSSIP.HOPS.default */
	broadcast(data, topic, HOPS) { this.gossip.broadcastToAll(data, topic, HOPS); }
	/** @param {string} remoteId @param {string | Uint8Array | Object} data @param {string} type */
	sendMessage(remoteId, data, type, spread = 1) { this.messager.sendUnicast(remoteId, data, type, spread); }
	async tryConnectToPeer(targetId = 'toto', retry = 5) { // TO REFACTO
		console.info('FUNCTION DISABLED FOR NOW');
		/*if (this.peerStore.connected[targetId]) return; // already connected
		do {
			if (this.peerStore.sdpOfferManager.readyOffer) break;
			else await new Promise(r => setTimeout(r, 1000)); // build in progress...
		} while (retry-- > 0);*/
	}
	destroy() {
		if (this.enhancerInterval) clearInterval(this.enhancerInterval);
		this.enhancerInterval = null;
		if (this.peerStoreInterval) clearInterval(this.peerStoreInterval);
		this.peerStoreInterval = null;
		this.peerStore.destroy();
		if (this.wsServer) this.wsServer.close();
		if (this.stunServer) this.stunServer.close();
	}
}
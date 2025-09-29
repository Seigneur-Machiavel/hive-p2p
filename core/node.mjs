import { CLOCK, SIMULATION, NODE, SERVICE, DISCOVERY } from './config.mjs';
import { Arbiter } from './arbiter.mjs';
import { OfferManager } from './ice-offer-manager.mjs';
import { PeerStore } from './peer-store.mjs';
import { UnicastMessager } from './unicast.mjs';
import { Gossip } from './gossip.mjs';
import { Topologist } from './topologist.mjs';
import { CryptoCodex } from './crypto-codex.mjs';
import { NodeServices } from './node-services.mjs';

/** Create and start a new PublicNode instance.
 * @param {Object} options
 * @param {string[]} options.bootstraps List of bootstrap nodes used as P2P network entry
 * @param {boolean} [options.autoStart] If true, the node will automatically start after creation (default: true)
 * @param {CryptoCodex} [options.cryptoCodex] Identity of the node; if not provided, a new one will be generated
 * @param {string} [options.domain] If provided, the node will operate as a public node and start necessary services (e.g., WebSocket server)
 * @param {number} [options.port] If provided, the node will listen on this port (default: SERVICE.PORT)
 * @param {number} [options.verbose] Verbosity level for logging (default: NODE.DEFAULT_VERBOSE) */
export async function createPublicNode(options) {		
	const verbose = options.verbose !== undefined ? options.verbose : NODE.DEFAULT_VERBOSE;
	const domain = options.domain || undefined;
	const codex = options.cryptoCodex || new CryptoCodex(undefined, verbose);
	if (!codex.publicKey) await codex.generate(domain ? true : false);
	
	const node = new Node(codex, options.bootstraps || [], verbose);
	if (domain) {
		node.services = new NodeServices(codex, node.peerStore, undefined, verbose);
		node.services.start(domain, options.port || SERVICE.PORT);
		node.topologist.services = node.services;
	}
	if (options.autoStart !== false) await node.start();
	return node;
}

/** Create and start a new Node instance.
 * @param {Object} options
 * @param {string[]} options.bootstraps List of bootstrap nodes used as P2P network entry
 * @param {CryptoCodex} [options.cryptoCodex] Identity of the node; if not provided, a new one will be generated
 * @param {boolean} [options.autoStart] If true, the node will automatically start after creation (default: true)
 * @param {number} [options.verbose] Verbosity level for logging (default: NODE.DEFAULT_VERBOSE) */
export async function createNode(options = {}) {
	const verbose = options.verbose !== undefined ? options.verbose : NODE.DEFAULT_VERBOSE;
	const codex = options.cryptoCodex || new CryptoCodex(undefined, verbose);
	if (!codex.publicKey) await codex.generate(false);

	const node = new Node(codex, options.bootstraps || [], verbose);
	if (options.autoStart !== false) await node.start();
	return node;
}

export class Node {
	started = false;
	id; cryptoCodex; verbose; arbiter;
	/** class managing ICE offers */ offerManager;
	/** class managing network connections */ peerStore;
	/** class who manage direct messages */ messager;
	/** class who manage gossip messages */ gossip;
	/** class managing network connections */ topologist;
	/** @type {NodeServices | undefined} */ services;

	/** Initialize a new P2P node instance, use .start() to init topologist
	 * @param {CryptoCodex} cryptoCodex - Identity of the node.
	 * @param {string[]} bootstraps List of bootstrap nodes used as P2P network entry */
	constructor(cryptoCodex, bootstraps = [], verbose = NODE.DEFAULT_VERBOSE) {
		this.verbose = verbose;
		if (this.topologist?.services) this.topologist.services.verbose = verbose;
		this.cryptoCodex = cryptoCodex;
		this.id = this.cryptoCodex.id;
		const stunUrls = NodeServices.deriveSTUNServers(bootstraps || []);
		this.offerManager = new OfferManager(this.id, stunUrls, verbose);
		this.arbiter = new Arbiter(this.id, cryptoCodex, verbose);
		this.peerStore = new PeerStore(this.id, this.cryptoCodex, this.offerManager, this.arbiter, verbose);
		this.messager = new UnicastMessager(this.id, this.cryptoCodex, this.arbiter, this.peerStore, verbose);
		this.gossip = new Gossip(this.id, this.cryptoCodex, this.arbiter, this.peerStore, verbose);
		this.topologist = new Topologist(this.id, this.cryptoCodex, this.gossip, this.messager, this.peerStore, bootstraps || []);
		const { arbiter, peerStore, messager, gossip, topologist } = this;

		// SETUP TRANSPORTS LISTENERS
		peerStore.on('signal', (peerId, data) => this.sendMessage(peerId, data, 'signal_answer')); // answer created => send it to offerer
		peerStore.on('connect', (peerId, direction) => this.#onConnect(peerId, direction));
		peerStore.on('disconnect', (peerId, direction) => this.#onDisconnect(peerId, direction));
		peerStore.on('data', (peerId, data) => this.#onData(peerId, data));
		
		// UNICAST LISTENERS
		messager.on('signal_answer', (senderId, data) => topologist.handleIncomingSignal(senderId, data));
		messager.on('signal_offer', (senderId, data) => topologist.handleIncomingSignal(senderId, data));

		// GOSSIP LISTENERS
		gossip.on('signal_offer', (senderId, data, HOPS) => topologist.handleIncomingSignal(senderId, data, HOPS));

		if (verbose > 2) console.log(`Node initialized: ${this.id}`);
	}

	// PRIVATE METHODS
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#onConnect = (peerId, direction) => {
		const remoteIsPublic = this.cryptoCodex.isPublicNode(peerId);
		if (this.publicUrl) return; // public node do not need to do anything special on connect
		if (this.verbose > ((this.publicUrl || remoteIsPublic) ? 3 : 2)) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection established with peer ${peerId}`);
		const bothAreNotPublic = !remoteIsPublic && !this.cryptoCodex.isPublicNode(this.id);
		if (bothAreNotPublic || direction === 'in') this.sendMessage(peerId, this.id, 'handshake'); // send it in both case, no doubt...
		
		const isHoverNeighbored = this.peerStore.neighborsList.length >= DISCOVERY.TARGET_NEIGHBORS_COUNT + this.halfTarget;
		const dispatchEvents = () => {
			//this.sendMessage(peerId, this.id, 'handshake'); // send it in both case, no doubt...
			if (DISCOVERY.ON_CONNECT_DISPATCH.OVER_NEIGHBORED && isHoverNeighbored)
				this.broadcast([], 'over_neighbored'); // inform my neighbors that I am over neighbored
			if (DISCOVERY.ON_CONNECT_DISPATCH.SHARE_HISTORY) 
				if (this.peerStore.getUpdatedPeerConnectionsCount(peerId) <= 1) this.gossip.sendGossipHistoryToPeer(peerId);
		};
		if (!DISCOVERY.ON_CONNECT_DISPATCH.DELAY) dispatchEvents();
		else setTimeout(dispatchEvents, DISCOVERY.ON_CONNECT_DISPATCH.DELAY);
	}
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#onDisconnect = (peerId, direction) => {
		if (!this.peerStore.neighborsList.length) { // If we are totally alone => kick all connecting peers and invalidate all offers
			for (const id in this.peerStore.connecting) this.peerStore.kickPeer(id, 0, 'no_neighbors_left');
			for (const offerId in this.offerManager.offers) this.offerManager.offers[offerId].timestamp = 0; // reset offers to retry
		}

		const remoteIsPublic = this.cryptoCodex.isPublicNode(peerId);
		if (this.peerStore.connected[peerId]) return; // still connected, ignore disconnection for now ?
		if (this.verbose > ((this.publicUrl || remoteIsPublic) ? 3 : 2)) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection closed with peer ${peerId}`);
		
		return; // no event dispatching for now
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
	get publicUrl() { return this.services?.publicUrl; }

	onMessageData(callback) { this.messager.on('message', callback); }
	onGossipData(callback) { this.gossip.on('gossip', callback); }
	
	async start() {
		await CLOCK.sync(this.verbose);
		this.started = true;
		if (SIMULATION.AVOID_INTERVALS) return true; // SIMULATOR CASE
		this.topologist.tryConnectNextBootstrap(); // first shot ASAP
		this.arbiterInterval = setInterval(() => this.arbiter.tick(), 1000);
		this.enhancerInterval = setInterval(() => this.topologist.tick(), DISCOVERY.LOOP_DELAY);
		this.peerStoreInterval = setInterval(() => { this.peerStore.cleanupExpired(); this.peerStore.offerManager.tick(); }, 2500);
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
			if (this.peerStore.offerManager.readyOffer) break;
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
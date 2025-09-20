import { CLOCK, SIMULATION, NODE, TRANSPORTS, DISCOVERY } from './global_parameters.mjs';
import { PeerStore } from './peer-store.mjs';
import { PeerConnection } from './peer-store-managers.mjs';
import { UnicastMessager } from './unicast.mjs';
import { Gossip } from './gossip.mjs';
import { NetworkEnhancer } from './network-enhancer.mjs';
import { CryptoCodec } from './crypto-codec.mjs';
const dgram = !NODE.IS_BROWSER ? await import('dgram') : null; // Node.js only

export class NodeP2P {
	started = false;
	verbose;
	cryptoCodec;
	/** should be based on crypto */ id;
	/** class managing network connections */ peerStore;
	/** class who manage direct messages */ messager;
	/** class who manage gossip messages */ gossip;
	/** class managing network */ networkEnhancer;
	/** @type {string | undefined} WebSocket URL (public node only) */ publicUrl;

	/** Initialize a new P2P node instance, use .start() to init networkEnhancer
	 * @param {CryptoCodec} [cryptoCodec] - Identity of the node; if not provided, a new one will be generated
	 * @param {Array<Record<string, string>>} bootstraps List of bootstrap nodes used as P2P network entry */
	constructor(cryptoCodec, bootstraps = [], verbose = NODE.DEFAULT_VERBOSE) {
		this.verbose = verbose;
		this.cryptoCodec = cryptoCodec || new CryptoCodec();
		if (!this.cryptoCodec.publicKey) this.cryptoCodec.generate(this.publicUrl);
		this.id = this.cryptoCodec.id;
		this.peerStore = new PeerStore(this.id, this.cryptoCodec, bootstraps, this.verbose);
		this.messager = new UnicastMessager(this.id, this.cryptoCodec, this.peerStore, this.verbose);
		this.gossip = new Gossip(this.id, this.cryptoCodec, this.peerStore, this.verbose);
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
		gossip.on('peer_connected', (senderId, data) => peerStore.handlePeerConnectedGossipEvent(senderId, data));
		gossip.on('peer_disconnected', (senderId, data) => peerStore.unlinkPeers(data, senderId));

		if (verbose > 2) console.log(`NodeP2P initialized: ${this.id}`);
	}

	// PRIVATE METHODS
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#onConnect = (peerId, direction) => {
		const [selfIsPublic, remoteIsPublic] = [this.publicUrl, this.cryptoCodec.isPublicNode(peerId)];
		if (selfIsPublic) return; // public node do not need to do anything special on connect
		if (this.verbose > ((selfIsPublic || remoteIsPublic) ? 3 : 2)) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection established with peer ${peerId}`);
		
		const dispatchEvents = () => {
			const isHandshakeInitiator = remoteIsPublic || direction === 'in';
			if (isHandshakeInitiator) this.sendMessage(peerId, this.id, 'handshake');
			if (DISCOVERY.ON_CONNECT_DISPATCH.BROADCAST_EVENT && !remoteIsPublic) this.broadcast(peerId, 'peer_connected');
			if (DISCOVERY.ON_CONNECT_DISPATCH.SHARE_HISTORY) 
				if (Object.keys(this.peerStore.known[peerId]?.neighbours).length <= 1) this.gossip.sendGossipHistoryToPeer(peerId);
		};
		if (!DISCOVERY.ON_CONNECT_DISPATCH.DELAY) dispatchEvents();
		else setTimeout(dispatchEvents, DISCOVERY.ON_CONNECT_DISPATCH.DELAY);
	}
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#onDisconnect = (peerId, direction) => {
		const [selfIsPublic, remoteIsPublic] = [this.publicUrl, this.cryptoCodec.isPublicNode(peerId)];
		const connDuration = this.peerStore.connected[peerId]?.getConnectionDuration() || 0;
		if (connDuration < DISCOVERY.ON_DISCONNECT_DISPATCH.MIN_CONNECTION_TIME) return;
		if (this.peerStore.connected[peerId]) return; // still connected, ignore disconnection for now ?
		if (this.verbose > ((selfIsPublic || remoteIsPublic) ? 3 : 2)) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection closed with peer ${peerId}`);
		
		const dispatchEvents = () => {
			if (DISCOVERY.ON_DISCONNECT_DISPATCH.BROADCAST_EVENT && !remoteIsPublic) this.broadcast(peerId, 'peer_disconnected');
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
	/** @param {Array<string>} bootstraps @param {CryptoCodec} [cryptoCodec] - Identity of the node; if not provided, a new one will be generated @param {boolean} [start] default: false @param {string} [domain] public node only, ex: 'localhost' @param {number} [port] public node only, ex: 8080 */
	static createNode(bootstraps, cryptoCodec, start = true, domain, port = NODE.SERVICE.PORT) {
		const node = new NodeP2P(cryptoCodec, bootstraps);
		if (domain) node.#setAsPublic(domain, port);
		if (domain && !SIMULATION.USE_TEST_TRANSPORTS) node.#startSTUNServer(domain, port + 1);
		if (start) node.start();
		return node;
	}
	start(initIntervals = !SIMULATION.AVOID_INTERVALS) {
		CLOCK.sync(this.verbose).then(() => {
			this.networkEnhancer.tryConnectNextBootstrap(); // first shot ASAP
			this.started = true;
			if (!initIntervals) return true;
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
	#setAsPublic(domain = 'localhost', port = NODE.SERVICE.PORT) {
		this.publicUrl = `ws://${domain}:${port}`;
		this.networkEnhancer.isPublicNode = true;
		
		// create simple ws server to accept incoming connections (Require to open port)
		this.wsServer = new TRANSPORTS.WS_SERVER({ port, host: domain });
		this.wsServer.on('error', (error) => console.error(`WebSocket error on Node #${this.id}:`, error));
		this.wsServer.on('connection', (ws) => {
			ws.on('close', () => { if (remoteId) for (const cb of this.peerStore.callbacks.disconnect) cb(remoteId, 'in'); });
			ws.on('error', (error) => console.error(`WebSocket error on Node #${this.id} with peer ${remoteId}:`, error.stack));

			let remoteId;
			ws.on('message', (data) => { // When peer proves his id, we can handle data normally
				if (remoteId) for (const cb of this.peerStore.callbacks.data) cb(remoteId, data);
				else { // First message should be handshake with id
					// C'EST PAS TERRIBLE !
					const d = new Uint8Array(data);
					if (d[0] > 127) return; // not unicast, ignore
					const { route, type } = this.cryptoCodec.readUnicastMessage(d) || {};
					if (type !== 'handshake' || route.length !== 2 || route[1] !== this.id) return;

					remoteId = route[0];
					this.peerStore.connecting[remoteId]?.out?.close(); // close outgoing connection if any
					this.peerStore.connecting[remoteId] = { in: new PeerConnection(remoteId, ws, 'in', true) };
					for (const cb of this.peerStore.callbacks.connect) cb(remoteId, 'in');
				}
			});
		});

		return { id: this.id, publicUrl: this.publicUrl };
	}
	#startSTUNServer(host, port) {
		this.stunServer = dgram.createSocket('udp4');
		
		this.stunServer.on('message', (msg, rinfo) => {
			console.log(`STUN message from ${rinfo.address}:${rinfo.port} - ${msg.toString('hex')}`);
			if (!this.#isValidSTUNRequest(msg)) return;
			
			const response = this.#buildSTUNResponse(msg, rinfo);
			this.stunServer.send(response, rinfo.port, rinfo.address);
		});
		
		this.stunServer.bind(port, host);
	}
	#isValidSTUNRequest(msg) {
		if (msg.length < 20) return false;
		const messageType = msg.readUInt16BE(0);
		const magicCookie = msg.readUInt32BE(4);
		return messageType === 0x0001 && magicCookie === 0x2112A442;
	}
	#buildSTUNResponse(request, rinfo) {
		const transactionId = request.subarray(8, 20); // copie les 12 bytes
		
		// Header : Success Response (0x0101) + length + magic + transaction
		const response = Buffer.allocUnsafe(32); // 20 header + 12 attribute
		response.writeUInt16BE(0x0101, 0);     // Binding Success Response
		response.writeUInt16BE(12, 2);         // Message Length (12 bytes d'attributs)
		response.writeUInt32BE(0x2112A442, 4); // Magic Cookie
		transactionId.copy(response, 8);       // Transaction ID
		
		// Attribut MAPPED-ADDRESS (8 bytes)
		response.writeUInt16BE(0x0001, 20);    // Type: MAPPED-ADDRESS
		response.writeUInt16BE(8, 22);         // Length: 8 bytes
		response.writeUInt16BE(0x0001, 24);    // Family: IPv4
		response.writeUInt16BE(rinfo.port, 26); // Port
		response.writeUInt32BE(this.#ipToInt(rinfo.address), 28); // IP
		
		console.log(`STUN Response: client will discover IP ${rinfo.address}:${rinfo.port}`);
		return response;
	}
	#ipToInt(ip) {
		return ip.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0);
	}
	destroy() {
		if (this.enhancerInterval) clearInterval(this.enhancerInterval);
		this.enhancerInterval = null;
		if (this.peerStoreInterval) clearInterval(this.peerStoreInterval);
		this.peerStoreInterval = null;
		this.peerStore.destroy();
		if (this.wsServer) this.wsServer.close();
	}
}
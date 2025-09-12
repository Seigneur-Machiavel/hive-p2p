import { PeerStore } from './peer-store.mjs';
import { PeerConnection } from './peer-store-managers.mjs';
import { NetworkEnhancer } from './network-enhancer.mjs';
import { UnicastMessager, DirectMessage } from './unicast.mjs';
import { Gossip, GossipMessage } from './gossip.mjs';
import { SIMULATION, TRANSPORTS, IDENTIFIERS, DISCOVERY, NODE } from './global_parameters.mjs';

/**
 * @typedef {import('ws').WebSocket} WebSocket
 * @typedef {import('simple-peer').Instance} SimplePeerInstance
 */

export class NodeP2P {
	verbose;
	/** @type {string | undefined} WebSocket URL (public node only) */ publicUrl;
	/** should be based on crypto */ id;
	/** class managing network connections */ peerStore;
	/** class who manage direct messages */ messager;
	/** class who manage gossip messages */ gossip;
	/** class managing network */ networkEnhancer;

	/** Initialize a new P2P node instance, use .start() to init networkEnhancer
	 * @param {string} id The unique identifier for the node (PubKey)
	 * @param {Array<Record<string, string>>} bootstraps List of bootstrap nodes used as P2P network entry */
	constructor(id = 'toto', bootstraps = [], verbose = NODE.DEFAULT_VERBOSE) {
		this.verbose = verbose;
		this.id = id;
		this.peerStore = new PeerStore(id, this.verbose);
		this.messager = new UnicastMessager(id, this.peerStore);
		this.gossip = new Gossip(id, this.peerStore);
		this.networkEnhancer = new NetworkEnhancer(id, this.gossip, this.peerStore, bootstraps);

		const { peerStore, networkEnhancer, messager, gossip } = this;
		// SETUP TRANSPORTS LISTENERS
		peerStore.on('signal', (peerId, data) => this.messager.sendMessage(peerId, 'signal', data)); // answer created => send it to offerer
		peerStore.on('signal_rejected', (peerId, neighbours) => this.messager.sendMessage(peerId, 'signal_rejected', neighbours));
		peerStore.on('connect', (peerId, direction) => this.#onConnect(peerId, direction));
		peerStore.on('disconnect', (peerId, direction) => this.#onDisconnect(peerId, direction));
		peerStore.on('data', (peerId, data) => this.#onData(peerId, data));
		
		// UNICAST LISTENERS
		messager.on('signal', (senderId, data) => networkEnhancer.handleIncomingSignal(senderId, data));
		messager.on('signal_rejected', (senderId, data) => networkEnhancer.handleSignalRejection(senderId, data));
		messager.on('gossip_history', (senderId, messages) => this.#handleIncomingGossipHistory(senderId, messages));

		// GOSSIP LISTENERS
		gossip.on('signal', (senderId, data) => networkEnhancer.handleIncomingSignal(senderId, data));
		gossip.on('peer_connected', (senderId, data) => peerStore.handlePeerConnectedGossipEvent(senderId, data));
		gossip.on('peer_disconnected', (senderId, data) => peerStore.unlinkPeers(data, senderId));
		gossip.on('my_neighbours', (senderId, data) => peerStore.digestPeerNeighbours(senderId, data));

		if (verbose > 2) console.log(`NodeP2P initialized: ${id}`);
	}

	// PRIVATE METHODS
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#onConnect = (peerId, direction) => {
		const [selfIsPublic, remoteIsPublic] = [this.publicUrl, peerId.startsWith(IDENTIFIERS.PUBLIC_NODE)];
		if (selfIsPublic) return; // public node do not need to do anything special on connect
		if (this.verbose > ((selfIsPublic || remoteIsPublic) ? 3 : 2)) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection established with peer ${peerId}`);
		
		const dispatchEvents = () => {
			const isHandshakeInitiator = (remoteIsPublic || direction === 'in');
			if (isHandshakeInitiator) this.sendMessage(peerId, 'handshake', { peerId: this.id });
			if (DISCOVERY.ON_CONNECT_DISPATCH.GOSSIP_HISTORY) this.sendMessage(peerId, 'gossip_history', this.gossip.bloomFilter.getGossipHistoryByTime());
			if (DISCOVERY.ON_CONNECT_DISPATCH.GOSSIP_NEIGHBOUR) this.broadcast('my_neighbours', this.peerStore.neighbours);
			if (DISCOVERY.ON_CONNECT_DISPATCH.SEND_EVENT && !remoteIsPublic) this.broadcast('peer_connected', peerId);
		};
		if (!DISCOVERY.ON_CONNECT_DISPATCH.DELAY) dispatchEvents();
		else setTimeout(dispatchEvents, DISCOVERY.ON_CONNECT_DISPATCH.DELAY);
	}
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#onDisconnect = (peerId, direction) => {
		const [selfIsPublic, remoteIsPublic] = [this.publicUrl, peerId.startsWith(IDENTIFIERS.PUBLIC_NODE)];
		const connDuration = this.peerStore.connected[peerId]?.getConnectionDuration() || 0;
		if (connDuration < DISCOVERY.ON_DISCONNECT_DISPATCH.MIN_CONNECTION_TIME) return;
		if (this.peerStore.connected[peerId]) return; // still connected, ignore disconnection for now ?
		if (this.verbose > ((selfIsPublic || remoteIsPublic) ? 3 : 2)) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection closed with peer ${peerId}`);
		
		const dispatchEvents = () => {
			if (DISCOVERY.ON_DISCONNECT_DISPATCH.SEND_EVENT && !remoteIsPublic) this.broadcast('peer_disconnected', peerId);
		};
		if (!DISCOVERY.ON_DISCONNECT_DISPATCH.DELAY) dispatchEvents();
		else setTimeout(dispatchEvents, DISCOVERY.ON_DISCONNECT_DISPATCH.DELAY);
	}
	#onData = (peerId, data) => {
		// SHOULD BE BETTER TO NOT DESERIALIZE HERE
		// WE WILL USE FIRST BIT TO DISTINGUISH UNICAST / GOSSIP
		const identifier = data[0];
		const deserialized = identifier === 'U' ? DirectMessage.deserialize(data) : GossipMessage.deserialize(data);
		if (deserialized.route) this.messager.handleDirectMessage(peerId, deserialized, data);
		else this.gossip.handleGossipMessage(peerId, deserialized, data);
	}
	/** @param {string} from @param {Array<{senderId: string, topic: string, data: string | Uint8Array, timestamp: number}>} gossipHistory */
	#handleIncomingGossipHistory(from, gossipHistory = []) {
		for (const msg of gossipHistory) {
			const { senderId, topic, data, timestamp } = msg;
			if (!this.gossip.bloomFilter.addMessage(senderId, topic, data, timestamp)) continue;
			if (topic === 'my_neighbours') this.peerStore.digestPeerNeighbours(senderId, data);
			else if (topic === 'peer_disconnected') this.peerStore.unlinkPeers(data, senderId);
			else if (topic === 'peer_connected') this.peerStore.handlePeerConnectedGossipEvent(senderId, data);
		}
	}

	// PUBLIC API
	/** @param {string} id @param {Array<string>} bootstraps */
	static createNode(id = 'toto', bootstraps = [], start = true) {
		const node = new NodeP2P(id, bootstraps);
		if (start) node.start();
		return node;
	}
	start() { this.networkEnhancer.init(); return true; }
	/** Broadcast a message to all connected peers or to a specified peer
	 * @param {string} topic @param {string | Uint8Array} data @param {string} [targetId] default: broadcast to all
	 * @param {number} [timestamp] default: Date.now() @param {number} [TTL] default: GOSSIP.TTL[topic] || GOSSIP.TTL.default */
	broadcast(topic, data, targetId, timestamp = Date.now(), TTL) { this.gossip.broadcast(topic, data, targetId, timestamp, TTL); }
	/** @param {string} remoteId @param {string} type @param {string | Uint8Array} data */
	sendMessage(remoteId, type, data, spread = 1) { this.messager.sendMessage(remoteId, type, data, spread); }
	async tryConnectToPeer(targetId = 'toto', retry = 5) {
		console.info('FUNCTION DISABLED FOR NOW');
		/*if (this.peerStore.connected[targetId]) return; // already connected
		do {
			if (this.peerStore.sdpOfferManager.readyOffer) break;
			else await new Promise(r => setTimeout(r, 1000)); // build in progress...
		} while (retry-- > 0);
		
		const readyOffer = this.peerStore.sdpOfferManager.readyOffer;
		this.messager.sendMessage(targetId, 'signal', { signal: readyOffer, neighbours: this.peerStore.neighbours });*/
	}
	setAsPublic(domain = 'localhost', port = NODE.SERVICE.PORT) {
		this.publicUrl = `ws://${domain}:${port}`;
		this.networkEnhancer.isPublicNode = true;
		
		// create simple ws server to accept incoming connections (Require to open port)
		this.wsServer = new TRANSPORTS.WS_SERVER({ port, host: domain });
		this.wsServer.on('error', (error) => console.error(`WebSocket error on Node #${this.id}:`, error));
		this.wsServer.on('connection', (ws) => {
			ws.on('close', () => { if (remoteId) for (const cb of this.peerStore.callbacks.disconnect) cb(remoteId, 'in'); });
			ws.on('error', (error) => console.error(`WebSocket error on Node #${this.id} with peer ${remoteId}:`, error.stack));

			let remoteId;
			ws.on('message', (message) => { // When peer proves his id, we can handle data normally
				if (remoteId) for (const cb of this.peerStore.callbacks.data) cb(remoteId, message);
				else { // First message should be handshake with id
					remoteId = UnicastMessager.handleHandshake(this.id, message);
					if (!remoteId || this.peerStore.connecting[remoteId]) return ws.close(); // already connecting, abort operation
	
					this.peerStore.connecting[remoteId] = { in: new PeerConnection(remoteId, ws, 'in', true) };
					for (const cb of this.peerStore.callbacks.connect) cb(remoteId, 'in');
				}
			});
		});

		return { id: this.id, publicUrl: this.publicUrl };
	}
	destroy() {
		this.networkEnhancer.stopAutoEnhancement();
		this.peerStore.destroy();
		if (this.wsServer) this.wsServer.close();
	}
}
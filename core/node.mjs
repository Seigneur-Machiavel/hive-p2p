import { WebSocketServer } from 'ws';
import { TestWsServer } from '../simulation/test-transports.mjs';
import { PeerStore } from './peer-store.mjs';
import { PeerConnection } from './peer-store-utils.mjs';
import { NetworkEnhancer } from './network-enhancer.mjs';
import { UnicastMessager, DirectMessage } from './unicast.mjs';
import { Gossip, GossipMessage } from './gossip.mjs';
import { IDENTIFIERS, DISCOVERY, NODE } from './global_parameters.mjs';

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
	constructor(id = 'toto', bootstraps = [], verbose = 0) {
		this.verbose = verbose;
		this.id = id;
		this.peerStore = new PeerStore(id, this.verbose);
		this.messager = new UnicastMessager(id, this.peerStore);
		this.gossip = new Gossip(id, this.peerStore);
		this.networkEnhancer = new NetworkEnhancer(id, this.gossip, this.peerStore, bootstraps);

		const { peerStore, networkEnhancer, messager, gossip } = this;
		// SETUP TRANSPORT LISTENERS
		peerStore.on('signal', (peerId, data) => this.messager.sendMessage(peerId, 'signal', data)); // answer created => send it to offerer
		peerStore.on('signal_rejected', (peerId, neighbours) => this.messager.sendMessage(peerId, 'signal_rejected', neighbours));
		peerStore.on('connect', (peerId, direction) => this.#onConnect(peerId, direction));
		peerStore.on('disconnect', (peerId, direction) => this.#onDisconnect(peerId, direction));
		peerStore.on('data', (peerId, data) => this.#onData(peerId, data));
		
		// UNICAST LISTENERS
		messager.on('signal', (senderId, data) => networkEnhancer.handleIncomingSignal(senderId, data));
		messager.on('signal_rejected', (senderId, data) => networkEnhancer.handleSignalRejection(senderId, data));
		messager.on('gossip_history', (senderId, messages) => networkEnhancer.handleIncomingGossipHistory(senderId, messages));

		// GOSSIP LISTENERS
		gossip.on('peer_connected', (senderId, data) => peerStore.handlePeerConnectedGossipEvent(senderId, data));
		gossip.on('peer_disconnected', (senderId, data) => peerStore.unlinkPeers(data, senderId));
		gossip.on('my_neighbours', (senderId, data) => peerStore.digestPeerNeighbours(senderId, data));
		gossip.on('signal', (senderId, data) => networkEnhancer.handleIncomingSignal(senderId, data));

		if (verbose > 0) console.log(`NodeP2P initialized: ${id}`);

		// TEST / UPDATE => the delay needs to be lowered => only used to improve network consistency
		setInterval(() => {
			this.peerStore.digestPeerNeighbours(this.id, this.peerStore.neighbours); // Self 'known' update
			if (DISCOVERY.NEIGHBOUR_GOSSIP) this.broadcast('my_neighbours', this.peerStore.neighbours);
		}, 10_000);
	}

	// PRIVATE METHODS
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#onConnect = (peerId, direction) => {
		if (this.peerStore.isKicked(peerId)) return;
		if (this.verbose) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection established with peer ${peerId}`);
		
		const [selfIsPublic, remoteIsPublic] = [this.publicUrl, peerId.startsWith(IDENTIFIERS.PUBLIC_NODE)];
		
		
		//if (selfIsPublic && direction === 'out') if (DISCOVERY.NEIGHBOUR_GOSSIP) this.broadcast('my_neighbours', this.peerStore.neighbours);

		//if (selfIsPublic && direction === 'in') this.broadcast('my_neighbours', this.peerStore.neighbours);
		//else this.gossip.broadcastToPeer(peerId, 'my_neighbours', this.peerStore.neighbours);

		//if (!selfIsPublic && direction === 'out' && remoteIsPublic) this.networkEnhancer.tryConnectMoreNodes();

		//if (DISCOVERY.GOSSIP_HISTORY) this.sendMessage(peerId, 'gossip_history', this.gossip.bloomFilter.getGossipHistoryByTime());
		//if (DISCOVERY.CONNECTED_EVENT) this.broadcast('peer_connected', peerId);
		//if (DISCOVERY.NEIGHBOUR_GOSSIP) this.broadcast('my_neighbours', this.peerStore.neighbours);
		//setTimeout(() => {
		//}, 500);
	}
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#onDisconnect = (peerId, direction) => {
		if (this.verbose) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} connection closed with peer ${peerId}`);
		this.peerStore.digestPeerNeighbours(peerId, this.peerStore.neighbours); // Self
		const connDuration = this.peerStore.connected[peerId]?.getConnectionDuration() || 0;
		if (connDuration < NODE.MIN_CONNECTION_TIME_TO_DISPATCH_EVENT) return;

		this.peerStore.unlinkPeers(this.id, peerId);
		if (DISCOVERY.DISCONNECTED_EVENT) this.broadcast('peer_disconnected', peerId);
	}
	#onData = (peerId, data) => {
		// SHOULD BE BETTER TO NOT DESERIALIZE HERE
		// WE WILL USE FIRST BIT TO DISTINGUISH UNICAST / GOSSIP
		const identifier = data[0];
		const deserialized = identifier === 'U' ? DirectMessage.deserialize(data) : GossipMessage.deserialize(data);
		if (deserialized.route) this.messager.handleDirectMessage(peerId, deserialized, data, this.verbose);
		else this.gossip.handleGossipMessage(peerId, deserialized, data, this.verbose);
	}

	// PUBLIC API
	/** @param {string} id @param {Array<string>} bootstraps */
	static createNode(id = 'toto', bootstraps = [], start = true) {
		const node = new NodeP2P(id, bootstraps);
		if (start) node.start();
		return node;
	}
	start() { this.networkEnhancer.init(); return true; }
	/** @param {string} topic @param {string | Uint8Array} data @param {string} [targetId] @param {number} [TTL] */
	broadcast(topic, data, targetId, TTL) { this.gossip.broadcast(topic, data, targetId, TTL); }
	/** @param {string} remoteId @param {string} type @param {string | Uint8Array} data */
	sendMessage(remoteId, type, data, spread = 1) { this.messager.sendMessage(remoteId, type, data, spread); }
	// DEPRECATED -> NEEDS REFACTORING
	//tryConnectToPeer(targetId = 'toto') {  }
	setAsPublic(domain = 'localhost', port = NODE.SERVICE.PORT) {
		this.publicUrl = `ws://${domain}:${port}`;
		this.networkEnhancer.isPublicNode = true;
		this.networkEnhancer.stopAutoEnhancement(); // avoid auto-connections
		
		// public node kick peer after 1min and ban it for 1min to improve network consistency
		const [{min, max}, kickDuration] = [NODE.SERVICE.AUTO_KICK_DELAY, NODE.SERVICE.AUTO_KICK_DURATION];
		const kickDelay = () => Math.round(Math.random() * (max - min) + min);
		this.peerStore.on('connect', (peerId, direction) => { // kick all incoming peers after a delay
			if (direction === 'in') setTimeout(() => this.peerStore.kickPeer(peerId, kickDuration), kickDelay());
		});
		
		// create simple ws server to accept incoming connections (Require to open port)
		const Transport = NODE.USE_TEST_TRANSPORT ? TestWsServer : WebSocketServer;
		this.wsServer = new Transport({ port, host: domain });
		this.wsServer.on('error', (error) => console.error(`WebSocket error on Node #${this.id}:`, error));
		this.wsServer.on('connection', (ws) => {
			ws.on('close', () => { for (const cb of this.peerStore.callbacks.disconnect) cb(remoteId, 'in'); });
			ws.on('error', (error) => console.error(`WebSocket error on Node #${this.id} with peer ${remoteId}:`, error.stack));
			if (this.wsServer.clients.size > NODE.SERVICE.MAX_WS_IN_CONNS) ws.close();

			let remoteId;
			ws.on('message', (message) => { try {
				const identifier = message[0];
				const deserialized = identifier === 'U' ? DirectMessage.deserialize(message) : GossipMessage.deserialize(message);
				const { senderId, topic, type, data, TTL } = deserialized;
				if (this.peerStore.isKicked(senderId)) return;
				if (topic !== 'signal' && type !== 'signal') return; // ignore non-signal messages here
				
				//if (topic && TTL !== 0)
					//return; 

				// TRY DEBUG
				/** @type {string | undefined} */ let result;
				if (topic) result = this.gossip.handleGossipMessage(senderId, deserialized, message, this.verbose);
				else if (remoteId) this.messager.handleDirectMessage(remoteId, deserialized, message, this.verbose);
				if (!result?.senderId || remoteId) return;

				remoteId = result.senderId;
				this.peerStore.addConnectedPeer(remoteId, new PeerConnection(remoteId, ws, 'in', true));
			} catch (error) { if (this.verbose > 0) console.error(`Error handling incoming signal for ${remoteId}:`, error.stack); } });

			setTimeout(() => { // better if we can kick IP address instead of id only
				if (remoteId) this.peerStore.kickPeer(remoteId, kickDuration);
				if (ws?.readyState === 1) ws?.close();
			}, kickDelay());
		});

		return { id: this.id, publicUrl: this.publicUrl };
	}
	destroy() {
		this.peerStore.destroy();
		this.networkEnhancer.destroy();
		if (this.wsServer) this.wsServer.close();
	}
}
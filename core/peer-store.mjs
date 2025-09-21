import { CLOCK, SIMULATION, DISCOVERY } from './global_parameters.mjs';
import { PeerConnection, KnownPeer, SdpOfferManager, Punisher } from './peer-store-managers.mjs';
const { SANDBOX, ICE_CANDIDATE_EMITTER, TEST_WS_EVENT_MANAGER } = SIMULATION.ENABLED ? await import('../simulation/test-transports.mjs') : {};
/** @typedef {{ in: PeerConnection, out: PeerConnection }} PeerConnecting */

export class PeerStore { // Manages all peers informations and connections (WebSocket and WebRTC)
	cryptoCodex;
	verbose;
	id;
	sdpOfferManager;
	punisher = new Punisher();
	/** @type {string[]} The neighbors IDs */ 		neighbors = []; // faster access
	/** @type {Record<string, PeerConnecting>} */ 	connecting = {};
	/** @type {Record<string, PeerConnection>} */ 	connected = {};
	/** @type {Record<string, KnownPeer>} */ 	  	known = {};
	/** @type {Record<string, Function[]>} */ 		callbacks = {
		'connect': [(peerId, direction) => this.#handleConnect(peerId, direction)],
		'disconnect': [(peerId, direction) => this.#handleDisconnect(peerId, direction)],
		'signal': [],
		'data': []
	};

	/** @param {string} selfId @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex @param {Array<bootstrapInfo>} bootstraps @param {number} [verbose] default: 0 */
	constructor(selfId, cryptoCodex, bootstraps, verbose = 0) { // SETUP SDP_OFFER_MANAGER CALLBACKS
		this.cryptoCodex = cryptoCodex; this.verbose = verbose; this.id = selfId;
		this.sdpOfferManager = new SdpOfferManager(selfId, bootstraps, verbose);

		/** @param {string} remoteId @param {any} signalData @param {string} [offerHash] answer only */
		this.sdpOfferManager.onSignalAnswer = (remoteId, signalData, offerHash) => { // answer only
			if (this.isDestroy || this.punisher.isSanctioned(remoteId)) return; // not accepted
			for (const cb of this.callbacks.signal) cb(remoteId, { signal: signalData, offerHash });
		};
		/** @param {string | undefined} remoteId @param {import('simple-peer').Instance} instance */
		this.sdpOfferManager.onConnect = (remoteId, instance) => {
			if (this.isDestroy) return instance?.destroy();
			if (remoteId === this.id) throw new Error(`Refusing to connect to self (${this.id}).`);

			let peerId = remoteId;
			instance.on('close', () => { if (peerId) for (const cb of this.callbacks.disconnect) cb(peerId, instance.initiator ? 'out' : 'in'); });
			instance.on('data', data => {
				if (peerId) for (const cb of this.callbacks.data) cb(peerId, data);
				else { // FIRST MESSAGE SHOULD BE HANDSHAKE WITH ID
					const d = new Uint8Array(data); if (d[0] > 127) return; // not unicast, ignore
					const { route, type, neighbors } = cryptoCodex.readUnicastMessage(d) || {};
					if (type !== 'handshake' || route.length !== 2 || route[1] !== this.id) return;
					peerId = route[0];
					this.digestPeerNeighbors(peerId, neighbors || []); // Update known store
					this.connecting[peerId]?.in?.close(); // close outgoing connection if any
					for (const cb of this.callbacks.connect) cb(peerId, 'out');
				}
			});
			// IF WE KNOW PEER ID, WE CAN LINK IT (SHOULD BE IN CONNECTING)
			if (remoteId) for (const cb of this.callbacks.connect) cb(remoteId, 'in');
		};
	}

	// PRIVATE METHODS
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#handleConnect(peerId, direction) { // First callback assigned in constructor
		if (!this.connecting[peerId]?.[direction]) return this.verbose > 3 ? console.info(`%cPeer with ID ${peerId} is not connecting.`, 'color: orange;') : null;
		
		const peerConn = this.connecting[peerId][direction];
		this.#removePeer(peerId, 'connecting', 'both');
		if (this.isKicked(peerId)) {
			if (this.verbose > 3) console.info(`(${this.id}) Connect => Peer with ID ${peerId} is kicked. => close()`, 'color: orange;');
			return peerConn.close();
		}

		if (this.connected[peerId]) {
			if (this.verbose > 1) console.warn(`(${this.id}) Connect => Peer with ID ${peerId} is already connected. => close()`);
			return peerConn.close();
		}
	
		peerConn.setConnected(); // set connStartTime
		this.connected[peerId] = peerConn;
		this.neighbors.push(peerId);
		this.#linkPeers(this.id, peerId); // Add link in self store
		if (this.verbose > (this.cryptoCodex.isPublicNode(peerId) ? 3 : 2)) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} ${peerConn.isWebSocket ? 'WebSocket' : 'WRTC'} connection established with peer ${peerId}`);
	}
	#handleDisconnect(peerId, direction) { // First callback assigned in constructor
		this.#removePeer(peerId, 'connected', direction);
		this.unlinkPeers(this.id, peerId); // Remove link in self known store
	}
	/** @param {string} remoteId @param {'connected' | 'connecting' | 'both'} [status] default: both @param {'in' | 'out' | 'both'} [direction] default: both */
	#removePeer(remoteId, status = 'both', direction = 'both') {
		if (!remoteId && remoteId === this.id) return;
		this.unlinkPeers(this.id, remoteId); // Remove link in self known store

		const [ connectingConns, connectedConn ] = [ this.connecting[remoteId], this.connected[remoteId] ];
		if (connectingConns && connectedConn) throw new Error(`Peer ${remoteId} is both connecting and connected.`);
		if (!connectingConns && !connectedConn) return;
		
		// use negation to apply to 'both' too
		if (status !== 'connecting' && (connectedConn?.direction === direction || direction === 'both')) {
			delete this.connected[remoteId];
			this.neighbors = this.neighbors.filter(id => id !== remoteId);
		}
		if (status === 'connected') return; // only remove connected
		
		const directionToRemove = direction === 'both' ? ['out', 'in'] : [direction];
		for (const dir of directionToRemove) delete connectingConns?.[dir];

		if (this.connecting[remoteId]?.['in'] || this.connecting[remoteId]?.['out']) return;
		delete this.connecting[remoteId]; // no more connection direction => remove entirely
	}
	#linkPeers(peerId1 = 'toto', peerId2 = 'tutu') {
		if (!this.known[peerId1]) this.known[peerId1] = new KnownPeer();
		if (!this.known[peerId2]) this.known[peerId2] = new KnownPeer();
		this.known[peerId1].setNeighbor(peerId2);
		this.known[peerId2].setNeighbor(peerId1);
	}
	cleanupExpired(andUpdateKnownBasedOnNeighbors = true) { // Clean up expired pending connections and pending links
		const now = CLOCK.time;
		for (const [peerId, peerConns] of Object.entries(this.connecting))
			for (const dir of ['in', 'out']) {
				if (peerConns[dir]?.pendingUntil > now) continue;
				if (this.verbose > 3) console.info(`%cPending ${dir} connection to peer ${peerId} expired.`, 'color: orange;');
				peerConns[dir]?.close();
				this.#removePeer(peerId, 'connecting', dir);
			}

		if (!andUpdateKnownBasedOnNeighbors) return;
		this.neighbors = Object.keys(this.connected);
		this.digestPeerNeighbors(this.id, this.neighbors); // Update self known store
	}
	#closePeerConnections(peerId) {
		this.connected[peerId]?.close();
		this.connecting[peerId]?.['in']?.close();
		this.connecting[peerId]?.['out']?.close();
	}

	// API
	/** @param {string} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) throw new Error(`Unknown callback type: ${callbackType}`);
		this.callbacks[callbackType].push(callback);
	}
	/** Initialize/Get a connecting peer WebRTC connection (SimplePeer Instance)
	 * @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} signal
	 * @param {string} [offerHash] offer only */
	addConnectingPeer(remoteId, signal, offerHash) {
		if (remoteId === this.id) throw new Error(`Refusing to connect to self (${this.id}).`);
		
		const peerConnection = this.sdpOfferManager.getPeerConnexionForSignal(remoteId, signal, offerHash);
		if (!peerConnection) return this.verbose > 3 ? console.info(`%cFailed to get/create a peer connection for ID ${remoteId}.`, 'color: orange;') : null;

		const direction = signal.type === 'offer' ? 'in' : 'out';
		if (this.connecting[remoteId]) this.connecting[remoteId][direction] = peerConnection;
		else this.connecting[remoteId] = { [direction]: peerConnection };
		return true;
	}
	/** @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} signal @param {string} [offerHash] answer only @param {number} timestamp Answer reception timestamp */
	assignSignal(remoteId, signal, offerHash, timestamp) {
		const peerConn = this.connecting[remoteId]?.[signal.type === 'offer' ? 'in' : 'out'];
		try {
			if (peerConn?.isWebSocket) throw new Error(`Cannot assign signal for ID ${remoteId}. (WebSocket)`);
			if (signal.type === 'answer') this.sdpOfferManager.addSignalAnswer(remoteId, signal, offerHash, timestamp);
			else peerConn.transportInstance.signal(signal);
		} catch (error) { console.error(`Error signaling ${signal?.type} for ${remoteId}:`, error.stack); }
	}
	/** Improve discovery by considering used route as peer links @param {string[]} route */
	digestValidRoute(route = []) { for (let i = 1; i < route.length; i++) this.#linkPeers(route[i - 1], route[i]); }
	/** @param {string} peerId @param {string[]} neighbors */
	digestPeerNeighbors(peerId, neighbors = []) { // Update known neighbors
		if (!peerId || !Array.isArray(neighbors)) return;
		const peerNeighbors = Object.keys(this.known[peerId]?.neighbors || {});
		for (const p of peerNeighbors) if (!neighbors.includes(p)) this.unlinkPeers(peerId, p);
		for (const p of neighbors) this.#linkPeers(peerId, p);
	}
	/** called on 'peer_disconnected' gossip message */
	unlinkPeers(peerId1 = 'toto', peerId2 = 'tutu') {
		if (this.known[peerId1]) this.known[peerId1]?.unsetNeighbor(peerId2);
		if (this.known[peerId2]) this.known[peerId2]?.unsetNeighbor(peerId1);
		if (this.known[peerId1]?.connectionsCount === 0) delete this.known[peerId1];
		if (this.known[peerId2]?.connectionsCount === 0) delete this.known[peerId2];
	}
	destroy() {
		this.isDestroy = true;
		for (const [peerId, conn] of Object.entries(this.connected)) { this.#removePeer(peerId); conn.close(); }
		for (const [peerId, connObj] of Object.entries(this.connecting)) { this.#removePeer(peerId); connObj['in']?.close(); connObj['out']?.close(); }
		this.sdpOfferManager.destroy();
	}

	// PUNISHER API
	/** Avoid peer connection and messages @param {string} peerId @param {number} duration default: 60_000ms */
	banPeer(peerId, duration = 60_000) {
		this.punisher.sanctionPeer(peerId, 'ban', duration);
		this.#closePeerConnections(peerId);
		this.#removePeer(peerId, 'both');
	}
	isBanned(peerId) { return this.punisher.isSanctioned(peerId, 'ban'); }
	/** Avoid peer connection @param {string} peerId @param {number} duration default: 60_000ms */
	kickPeer(peerId, duration = 60_000) {
		if (duration) this.punisher.sanctionPeer(peerId, 'kick', duration);
		this.connected[peerId]?.close();
		if (this.verbose > 1) console.log(`(${this.id}) Kicked peer ${peerId} for ${duration / 1000}s.`);
	}
	isKicked(peerId) { return this.punisher.isSanctioned(peerId, 'kick'); }
}
import { CLOCK, SIMULATION, DISCOVERY } from './global_parameters.mjs';
import { PeerConnection, KnownPeer, Punisher } from './peer-store-utilities.mjs';
const { SANDBOX, ICE_CANDIDATE_EMITTER, TEST_WS_EVENT_MANAGER } = SIMULATION.ENABLED ? await import('../simulation/test-transports.mjs') : {};
/** @typedef {{ in: PeerConnection, out: PeerConnection }} PeerConnecting */

export class PeerStore { // Manages all peers informations and connections (WebSocket and WebRTC)
	cryptoCodex;
	verbose;
	id;
	offerManager;
	punisher = new Punisher();
	/** @type {string[]} The neighbors IDs */ 		neighborsList = []; // faster access
	/** @type {Record<string, PeerConnecting>} */ 	connecting = {};
	/** @type {Record<string, PeerConnection>} */ 	connected = {};
	/** @type {Record<string, KnownPeer>} */ 	  	known = {}; // known peers store
	/** @type {number} */							knownCount = 0;
	/** @type {Record<string, Function[]>} */ 		callbacks = {
		'connect': [(peerId, direction) => this.#handleConnect(peerId, direction)],
		'disconnect': [(peerId, direction) => this.#handleDisconnect(peerId, direction)],
		'signal': [],
		'data': []
	};

	/** @param {string} selfId @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex @param {import('./ice-offer-manager.mjs').OfferManager} offerManager @param {number} [verbose] default: 0 */
	constructor(selfId, cryptoCodex, offerManager, verbose = 0) { // SETUP SDP_OFFER_MANAGER CALLBACKS
		this.cryptoCodex = cryptoCodex; this.verbose = verbose; this.id = selfId;
		this.offerManager = offerManager;

		/** @param {string} remoteId @param {any} signalData @param {string} [offerHash] answer only */
		this.offerManager.onSignalAnswer = (remoteId, signalData, offerHash) => { // answer only
			if (this.isDestroy || this.punisher.isSanctioned(remoteId)) return; // not accepted
			for (const cb of this.callbacks.signal) cb(remoteId, { signal: signalData, offerHash });
		};
		/** @param {string | undefined} remoteId @param {import('simple-peer').Instance} instance */
		this.offerManager.onConnect = (remoteId, instance) => {
			if (this.isDestroy) return instance?.destroy();
			if (remoteId === this.id) throw new Error(`Refusing to connect to self (${this.id}).`);

			let peerId = remoteId;
			instance.on('close', () => { if (peerId) for (const cb of this.callbacks.disconnect) cb(peerId, instance.initiator ? 'out' : 'in'); });
			instance.on('data', data => {
				if (peerId) for (const cb of this.callbacks.data) cb(peerId, data);
				else { // FIRST MESSAGE SHOULD BE HANDSHAKE WITH ID // USELESS ?
					const d = new Uint8Array(data); if (d[0] > 127) return; // not unicast, ignore
					const { route, type, neighborsList } = cryptoCodex.readUnicastMessage(d) || {};
					if (type !== 'handshake' || route.length !== 2 || route[1] !== this.id) return;
					
					peerId = route[0];
					this.digestPeerNeighbors(peerId, neighborsList); // Update known store
					for (const cb of this.callbacks.connect) cb(peerId, 'out');
				}
			});
			// IF WE KNOW PEER ID, WE CAN LINK IT (SHOULD BE IN CONNECTING)
			if (remoteId) for (const cb of this.callbacks.connect) cb(remoteId, 'in');
		};
	}

	// GETTERS
	get publicNeighborsList() { return this.neighborsList.filter(id => this.cryptoCodex.isPublicNode(id)); }
	get standardNeighborsList() { return this.neighborsList.filter(id => !this.cryptoCodex.isPublicNode(id)); }

	// PRIVATE METHODS
	/** @param {string} peerId @param {'in' | 'out'} direction */
	#handleConnect(peerId, direction) { // First callback assigned in constructor
		if (!this.connecting[peerId]?.[direction]) return this.verbose >= 3 ? console.info(`%cPeer with ID ${peerId} is not connecting.`, 'color: orange;') : null;
		
		const peerConn = this.connecting[peerId][direction];
		this.#removePeer(peerId, 'connecting', direction); // remove from connecting now, we are connected or will fail
		if (this.isKicked(peerId)) {
			if (this.verbose >= 3) console.info(`%c(${this.id}) Connect => Peer with ID ${peerId} is kicked. => close()`, 'color: orange;');
			return peerConn.close();
		}

		if (this.connected[peerId]) {
			if (this.verbose > 1) console.warn(`%c(${this.id}) Connect => Peer with ID ${peerId} is already connected. => close()`, 'color: orange;');
			return peerConn.close();
		}
	
		peerConn.setConnected(); // set connStartTime
		this.connected[peerId] = peerConn;
		this.neighborsList.push(peerId);
		this.#linkPeers(this.id, peerId); // Add link in self store
		//if (this.verbose > (this.cryptoCodex.isPublicNode(peerId) ? 3 : 2)) console.log(`(${this.id}) ${direction === 'in' ? 'Incoming' : 'Outgoing'} ${peerConn.isWebSocket ? 'WebSocket' : 'WRTC'} connection established with peer ${peerId}`);
	}
	#handleDisconnect(peerId, direction) { // First callback assigned in constructor
		this.#removePeer(peerId, 'connected', direction);
	}
	/** Remove a peer from our connections, and unlink from known store
	 * @param {string} remoteId @param {'connected' | 'connecting' | 'both'} [status] default: both @param {'in' | 'out' | 'both'} [direction] default: both */
	#removePeer(remoteId, status = 'both', direction = 'both') {
		if (!remoteId && remoteId === this.id) return;

		const [ connectingConns, connectedConn ] = [ this.connecting[remoteId], this.connected[remoteId] ];
		//if (connectingConns && connectedConn) throw new Error(`Peer ${remoteId} is both connecting and connected.`);
		if (!connectingConns && !connectedConn) return;
		
		// use negation to apply to 'both' too
		if (status !== 'connecting' && (connectedConn?.direction === direction || direction === 'both')) {
			connectedConn?.close();
			delete this.connected[remoteId];
			this.neighborsList = Object.keys(this.connected);
			this.#unlinkPeers(this.id, remoteId); // Remove link in self known store
		}
		if (status === 'connected') return; // only remove connected
		
		const directionToRemove = direction === 'both' ? ['out', 'in'] : [direction];
		for (const dir of directionToRemove) delete connectingConns?.[dir];

		if (this.connecting[remoteId]?.['in'] || this.connecting[remoteId]?.['out']) return;
		delete this.connecting[remoteId]; // no more connection direction => remove entirely
	}
	/** Associate two peers as neighbors in known store */
	#linkPeers(peerId1 = 'toto', peerId2 = 'tutu') {
		for (const pid of [peerId1, peerId2]) {
			if (!this.known[pid]) { this.known[pid] = new KnownPeer(); this.knownCount++; }
			this.known[pid].setNeighbor(pid === peerId1 ? peerId2 : peerId1); // set/update neighbor
		}
	}
	/** Unassociate two peers and remove them from known store if they have no more connections */
	#unlinkPeers(peerId1 = 'toto', peerId2 = 'tutu') {
		for (const pid of [peerId1, peerId2]) {
			if (!this.known[pid]) continue;
			this.known[pid].unsetNeighbor(pid === peerId1 ? peerId2 : peerId1);
			if (this.known[pid].connectionsCount > 0) continue;
			delete this.known[pid];
			this.knownCount--;
		}
	}
	cleanupExpired(andUpdateKnownBasedOnNeighbors = true) { // Clean up expired pending connections and pending links
		const now = CLOCK.time;
		for (const dir of ['in', 'out'])
			for (const peerId in this.connecting) {
				if (!this.connecting[peerId][dir]) continue;
				const bonusTime = this.connected[peerId] ? 10000 : 0; // give some extra time if we are already connected to this peer
				if (this.connecting[peerId][dir].pendingUntil + bonusTime > now) continue;
				if (this.verbose >= 3 && !this.connected[peerId]) console.info(`%c(${this.id}) Pending ${dir} connection to peer ${peerId} expired.`, 'color: orange;');
				if (this.verbose > 0 && this.connected[peerId]?.direction === dir) console.info(`%c(${this.id}) Pending ${dir} connection to peer ${peerId} expired (already connected WARNING!).`, 'color: white;');
				//if (!this.connecting[peerId]?.in?.isWebSocket) this.connecting[peerId]?.in?.close(); // close only in connection => out conn can be used by others answers
				//else this.connecting[peerId]?.close();
				if (this.connecting[peerId]?.out?.isWebSocket) this.connecting[peerId].out.close();
				this.connecting[peerId]?.in?.close();
				this.#removePeer(peerId, 'connecting', dir);
			}

		if (!andUpdateKnownBasedOnNeighbors) return;
		this.neighborsList = Object.keys(this.connected);
		this.digestPeerNeighbors(this.id, this.neighborsList); // Update self known store
	}

	// API
	/** @param {string} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) throw new Error(`Unknown callback type: ${callbackType}`);
		this.callbacks[callbackType].push(callback);
	}
	/** Cleanup expired neighbors and return the updated connections count @param {string} peerId */
	getUpdatedPeerConnectionsCount(peerId, includesPublic = true) {
		const time = CLOCK.time; let count = 0;
		const peerNeighbors = this.known[peerId]?.neighbors || {};
		for (const id in peerNeighbors) {// clean expired links (except self and non-expired)
			if (id !== this.id && time - peerNeighbors[id] > DISCOVERY.PEER_LINK_EXPIRATION) {
				this.#unlinkPeers(peerId, id);
				continue;
			}
			if (includesPublic) count++;
			else if (!this.cryptoCodex.isPublicNode(id)) count++;
		}
		return count;
	}
	/** Initialize/Get a connecting peer WebRTC connection (SimplePeer Instance)
	 * @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} signal
	 * @param {string} [offerHash] offer only */
	addConnectingPeer(remoteId, signal, offerHash) {
		if (remoteId === this.id) throw new Error(`Refusing to connect to self (${this.id}).`);
		
		const direction = signal.type === 'offer' ? 'in' : 'out';
		if (this.connecting[remoteId]?.[direction]) return; // already connecting out (should not happen)

		const peerConnection = this.offerManager.getPeerConnexionForSignal(remoteId, signal, offerHash);
		if (!peerConnection) return this.verbose > 3 ? console.info(`%cFailed to get/create a peer connection for ID ${remoteId}.`, 'color: orange;') : null;

		if (!this.connecting[remoteId]) this.connecting[remoteId] = {};
		if (this.connecting[remoteId]) this.connecting[remoteId][direction] = peerConnection;
		return true;
	}
	/** @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} signal @param {string} [offerHash] answer only @param {number} timestamp Answer reception timestamp */
	assignSignal(remoteId, signal, offerHash, timestamp) {
		const peerConn = this.connecting[remoteId]?.[signal.type === 'offer' ? 'in' : 'out'];
		try {
			if (peerConn?.isWebSocket) throw new Error(`Cannot assign signal for ID ${remoteId}. (WebSocket)`);
			if (signal.type === 'answer') this.offerManager.addSignalAnswer(remoteId, signal, offerHash, timestamp);
			else peerConn.transportInstance.signal(signal);
		} catch (error) { console.error(`Error signaling ${signal?.type} for ${remoteId}:`, error.stack); }
	}
	/** Improve discovery by considering used route as peer links @param {string[]} route */
	digestValidRoute(route = []) { for (let i = 1; i < route.length; i++) this.#linkPeers(route[i - 1], route[i]); }
	/** @param {string} peerId @param {string[]} neighbors */
	digestPeerNeighbors(peerId, neighbors = []) { // Update known neighbors
		if (!peerId || !Array.isArray(neighbors)) return;
		for (const id in this.known[peerId]?.neighbors || {}) // remove old links
			if (!neighbors.includes(id)) this.#unlinkPeers(peerId, id);
		for (const p of neighbors) this.#linkPeers(peerId, p);
	}
	destroy() {
		this.isDestroy = true;
		for (const [peerId, conn] of Object.entries(this.connected)) { this.#removePeer(peerId); conn.close(); }
		for (const [peerId, connObj] of Object.entries(this.connecting)) { this.#removePeer(peerId); connObj['in']?.close(); connObj['out']?.close(); }
		this.offerManager.destroy();
	}

	// PUNISHER API
	/** Avoid peer connection and messages @param {string} peerId @param {number} duration default: 60_000ms */
	banPeer(peerId, duration = 60_000) {
		if (duration) this.punisher.sanctionPeer(peerId, 'ban', duration);
		this.#removePeer(peerId, 'both');
		if (this.verbose > 1) console.log(`%c(${this.id}) Banned peer ${peerId} for ${duration / 1000}s.`, 'color: red;');
	}
	isBanned(peerId) { return this.punisher.isSanctioned(peerId, 'ban'); }
	/** Avoid peer connection @param {string} peerId @param {number} duration default: 60_000ms @param {string} [reason] */
	kickPeer(peerId, duration = 60_000, reason) {
		if (duration) this.punisher.sanctionPeer(peerId, 'kick', duration);
		this.#removePeer(peerId, 'both');
		if (this.verbose > 1) console.log(`%c(${this.id}) Kicked peer ${peerId} for ${duration / 1000}s. ${reason ? '| Reason: ' + reason : ''}`, 'color: green;');
	}
	isKicked(peerId) { return this.punisher.isSanctioned(peerId, 'kick'); }
}
import { SIMULATION, NODE, SERVICE, TRANSPORTS, DISCOVERY, LOG_CSS } from './config.mjs';
import { PeerConnection } from './peer-store.mjs';
import { Converter } from '../services/converter.mjs';
const dgram = !NODE.IS_BROWSER ? await import('dgram') : null;
/*const dgram = !NODE.IS_BROWSER ? 
  await import('dgram').catch(() => null) : 
  null;*/

export class NodeServices {
	id;
	verbose;
	maxKick;
	peerStore;
	cryptoCodex;
	/** @type {string | undefined} WebSocket URL (public node only) */ publicUrl;

	/** @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex @param {import('./peer-store.mjs').PeerStore} peerStore */
	constructor(cryptoCodex, peerStore, maxKick = 3, verbose = 1) {
		this.id = cryptoCodex.id;
		this.verbose = verbose;
		this.maxKick = maxKick;
		this.peerStore = peerStore;
		this.cryptoCodex = cryptoCodex;
	}
	
	start(domain = 'localhost', port = SERVICE.PORT) {
		this.publicUrl = `ws://${domain}:${port}`;
		this.#startWebSocketServer(domain, port);
		if (!SIMULATION.USE_TEST_TRANSPORTS) this.#startSTUNServer(domain, port + 1);
	}
	freePublicNodeByKickingPeers() {
		const maxKick = Math.min(this.maxKick, this.peerStore.neighborsList.length - DISCOVERY.TARGET_NEIGHBORS_COUNT);
		if (maxKick <= 0) return; // nothing to do
		
		let kicked = 0;
		const delay = SERVICE.AUTO_KICK_DELAY;
		for (const peerId  in this.peerStore.connected) {
			const conn = this.peerStore.connected[peerId];
			const nonPublicNeighborsCount = this.peerStore.getUpdatedPeerConnectionsCount(peerId, false);
			if (nonPublicNeighborsCount > DISCOVERY.TARGET_NEIGHBORS_COUNT) { // OVER CONNECTED
				this.peerStore.kickPeer(peerId, SERVICE.AUTO_KICK_DURATION, 'freePublicNode');
				if (this.peerStore.neighborsList.length <= DISCOVERY.TARGET_NEIGHBORS_COUNT) break;
				else continue; // Don't count in maxKick
			}

			if (conn.getConnectionDuration() < (nonPublicNeighborsCount > 2 ? delay : delay * 2)) continue;
			this.peerStore.kickPeer(peerId, SERVICE.AUTO_KICK_DURATION, 'freePublicNode');
			if (++kicked >= maxKick) break;
		}
	}
	#startWebSocketServer(domain = 'localhost', port = SERVICE.PORT) {
		this.wsServer = new TRANSPORTS.WS_SERVER({ port, host: domain });
		this.wsServer.on('error', (error) => console.error(`WebSocket error on Node #${this.id}:`, error));
		this.wsServer.on('connection', (ws) => {
			ws.on('close', () => { if (remoteId) for (const cb of this.peerStore.callbacks.disconnect) cb(remoteId, 'in'); });
			ws.on('error', (error) => console.error(`WebSocket error on Node #${this.id} with peer ${remoteId}:`, error.stack));

			let remoteId;
			ws.on('message', (data) => { // When peer proves his id, we can handle data normally
				if (remoteId) for (const cb of this.peerStore.callbacks.data) cb(remoteId, data);
				else { // FIRST MESSAGE SHOULD BE HANDSHAKE WITH ID
					const d = new Uint8Array(data); if (d[0] > 127) return; // not unicast, ignore
					const message = this.cryptoCodex.readUnicastMessage(d);
					if (!message) return; // invalid unicast message, ignore

					const { route, type, neighborsList } = message;
					if (type !== 'handshake' || route.length !== 2) return;

					const { signatureStart, pubkey, signature } = message;
					const signedData = d.subarray(0, signatureStart);
					if (!this.cryptoCodex.verifySignature(pubkey, signature, signedData)) return;

					remoteId = route[0];
					this.peerStore.digestPeerNeighbors(remoteId, neighborsList); // Update known store
					this.peerStore.connecting[remoteId]?.out?.close(); // close outgoing connection if any
					if (!this.peerStore.connecting[remoteId]) this.peerStore.connecting[remoteId] = {};
					this.peerStore.connecting[remoteId].in = new PeerConnection(remoteId, ws, 'in', true);
					for (const cb of this.peerStore.callbacks.connect) cb(remoteId, 'in');
				}
			});
			ws.send(this.cryptoCodex.createUnicastMessage('handshake', null, [this.id, this.id], this.peerStore.neighborsList));
		});
	}
	#startSTUNServer(host = 'localhost', port = SERVICE.PORT + 1) {
		this.stunServer = dgram.createSocket('udp4');
		this.stunServer.on('message', (msg, rinfo) => {
			if (this.verbose > 2) console.log(`%cSTUN message from ${rinfo.address}:${rinfo.port} - ${msg.toString('hex')}`, LOG_CSS.SERVICE);
			if (!this.#isValidSTUNRequest(msg)) return;
			this.stunServer.send(this.#buildSTUNResponse(msg, rinfo), rinfo.port, rinfo.address);
		});
		this.stunServer.bind(port, host);
		if (this.verbose > 2) console.log(`%cSTUN server listening on ${host}:${port}`, LOG_CSS.SERVICE);
	}
	#isValidSTUNRequest(msg) {
		if (msg.length < 20) return false;
		const messageType = msg.readUInt16BE(0);
		const magicCookie = msg.readUInt32BE(4);
		return messageType === 0x0001 && magicCookie === 0x2112A442;
	}
	#buildSTUNResponse(request, rinfo) {
		const transactionId = request.subarray(8, 20); // copy the 12 bytes

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
		response.writeUInt32BE(Converter.ipToInt(rinfo.address), 28); // IP
		
		if (this.verbose > 2) console.log(`%cSTUN Response: client will discover IP ${rinfo.address}:${rinfo.port}`, 'color: green;');
		return response;
	}
	/** @param {string[]} bootstraps */
	static deriveSTUNServers(bootstraps) {
		/** @type {Array<{urls: string}>} */
		const stunUrls = [];
		for (const b of bootstraps) {
			const domain = b.split(':')[1].replace('//', '');
			const port = parseInt(b.split(':')[2]) + 1;
			stunUrls.push({ urls: `stun:${domain}:${port}` });
		}
		if (!TRANSPORTS.CENTRALIZED_STUN_SERVERS) return stunUrls;

		// CENTRALIZED STUN SERVERS FALLBACK (GOOGLE) - OPTIONAL
		stunUrls.push({ urls: 'stun:stun.l.google.com:5349' });
		stunUrls.push({ urls: 'stun:stun.l.google.com:19302' });
		stunUrls.push({ urls: 'stun:stun1.l.google.com:3478' });
		stunUrls.push({ urls: 'stun:stun1.l.google.com:5349' });
		return stunUrls;
	}
}
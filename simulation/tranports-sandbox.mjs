/**
 * Sandbox for testing WebSocket and transport connections.
 * 
 * @typedef {import('./test-transports.mjs').TestWsConnection} TestWsConnection
 * @typedef {import('./test-transports.mjs').TestWsServer} TestWsServer
 * @typedef {import('./test-transports.mjs').TestTransport} TestTransport
 */

export class Sandbox {
	// --- WebSocket Simulation ---
	/** @type {Record<string, TestWsServer>} */
	publicWsServers = {};
	inscribeWebSocketServer(url, testWsServer) {
		this.publicWsServers[url] = testWsServer;
	}
	removeWebSocketServer(url) {
		delete this.publicWsServers[url];
	}
	/** @param {string} url @param {TestWsConnection} clientWsConnection */
	connectToWebSocketServer(url, clientWsConnection, instancier) {
		const server = this.publicWsServers[url];
		if (!server) return;
		const serverWsConnection = new instancier(server, clientWsConnection);
		server.callbacks.connection.forEach(cb => cb(serverWsConnection)); // emit connection event
		return serverWsConnection;
	}

	// --- SimplePeer Simulation ---
	static SIGNAL_TIMEOUT = 8_000;

	// -------------
	globalIndex = 0; // index to attribute transportInstances ID
	/** @type {Record<string, TestTransport>} */
	connections = {};
	/** @type {Record<string, TestTransport>} */
	transportInstances = {};
	inscribeInstance(transportInstance) {
		const transportId = this.globalIndex++;
		this.transportInstances[transportId] = transportInstance;
		return transportId;
	}
	#linkInstances(idA, idB) {
		const [ tA, tB ] = [this.transportInstances[idA], this.transportInstances[idB]];
		if (!tA || !tB) return; // one instances missing
		if (tA.closing || tB.closing) return; // one of the instances is closing

		const conns = this.connections;
		if (conns[idA] || conns[idB]) return; // at least one is already linked

		conns[idA] = tB;
		conns[idB] = tA;
		tA.callbacks.connect.forEach(cb => cb()); // emit connect event for transportInstance A
		tB.callbacks.connect.forEach(cb => cb()); // emit connect event for transportInstance B
		return true;
	}
	sendData(fromId, toId, data) {
		if (fromId === undefined) return { success: false, reason: `Cannot send message from id: ${fromId}` };
		if (toId === undefined) return { success: false, reason: `Cannot send message to id: ${toId}` };
		const transportInstance = this.connections[fromId];
		if (!transportInstance) return { success: false, reason: `No transport instance found for id: ${fromId}` };
		if (transportInstance.id !== toId) return { success: false, reason: `Wrong id for transportInstance ${fromId} !== ${toId}` };
		//for (const cb of transportInstance.callbacks.data) cb(data); // emit data event
		this.enqueueTransportData(transportInstance, data);
		return { success: true };
	}
	destroyTransport(id) {
		const sdp = this.PENDING_OFFERS[id];
		if (sdp !== undefined) this.#destroySignal(id, sdp.id);

		this.connections[id]?.close(); // close remote instance
		this.transportInstances[id]?.close(); // close local instance
		delete this.connections[id];
		delete this.transportInstances[id];
	}
	PENDING_OFFERS = {}; // key: id, value: signalData
	OFFERS_EMITTERS = {}; // key: signalId, value: id
	PENDING_ANSWERS = {}; // key: id, value: signalData
	ANSWER_EMITTERS = {}; // key: signalId, value: id
	cleanupInterval = setInterval(() => this.#cleanupExpiredSignals(), 2000);

	#cleanupExpiredSignals() {
		const now = Date.now();
		const timeout = Sandbox.SIGNAL_TIMEOUT;
		for (const [id, entry] of Object.entries(this.PENDING_OFFERS)) {
			if (now - entry.timestamp > timeout) {
				delete this.PENDING_OFFERS[id];
				delete this.OFFERS_EMITTERS[entry.signalData.id];
			}
		}
		
		for (const [id, entry] of Object.entries(this.PENDING_ANSWERS)) {
			if (now - entry.timestamp > timeout) {
				delete this.PENDING_ANSWERS[id];
				delete this.ANSWER_EMITTERS[entry.signalData.id];
			}
		}
	}
	#addSignalOffer(id, signalData) {
		this.PENDING_OFFERS[id] = signalData;
		this.OFFERS_EMITTERS[signalData.id] = id;
	}
	#addSignalAnswer(id, signalData) {
		this.PENDING_ANSWERS[id] = signalData;
		this.ANSWER_EMITTERS[signalData.id] = id;
	}
	buildSDP(id, type = 'offer') {
		const SDP = {
			type,
			sdp: {
				id: Math.random().toString(36).substring(2),
				v: '0',
				o: `- ${Math.random().toString(36).substring(2)} ${Math.floor(Math.random() * 1000000)} 2 IN IP4 127.0.0.1\r\n`,
				s: '-',
				t: '0 0',
				a: [
					'group:BUNDLE 0',
					'msid-semantic: WMS',
					'ice-ufrag:Cvvt',
					'ice-pwd:6jB1TY+roP0E44NQEavy9shl',
					'ice-options:trickle',
					'fingerprint:sha-256 FF:16:35:3A:3D:C2:5C:CD:A5:5D:21:B3:4E:31:3F:0B:5B:0B:3C:15:5B:59:A8:2C:A0:34:4E:8C:81:48:75:7D',
					'setup:actpass',
					'mid:0',
					'sctp-port:5000',
					'max-message-size:262144'
				]
			}
		}
		if (type === 'offer') this.#addSignalOffer(id, SDP.sdp);
		else if (type === 'answer') this.#addSignalAnswer(id, SDP.sdp);
		else return console.error(`Invalid signal type: ${type}. Expected 'offer' or 'answer'.`);

		return SDP;
	}
	#destroySignal(id) {
		const offer = this.PENDING_OFFERS[id];
		const answer = this.PENDING_ANSWERS[id];
		if (offer) {
			delete this.PENDING_OFFERS[id];
			delete this.OFFERS_EMITTERS[offer.id];
		} else if (answer) {
			delete this.PENDING_ANSWERS[id];
			delete this.ANSWER_EMITTERS[answer.id];
		}
	}
	digestSignal(SDP, receiverId) {
		const { type, sdp } = SDP;
		if (type !== 'answer' && type !== 'offer') return console.error(`Invalid signal type: ${type}. Expected 'offer' or 'answer'.`), { success: false };

		const signalAssociatedId = type === 'offer' ? this.OFFERS_EMITTERS[sdp.id] : this.ANSWER_EMITTERS[sdp.id];
		const receiver = this.transportInstances[receiverId];
		if (signalAssociatedId === undefined || receiver === undefined) return;

		if (type === 'answer') {
			this.#destroySignal(signalAssociatedId, sdp.id);
			if (this.#linkInstances(signalAssociatedId, receiverId)) return { success: true, remoteId: signalAssociatedId };
			else return console.error(`Failed to link transport instances for e:${signalAssociatedId} => r:${receiverId}`), { success: false };
		}
		
		return {
			success: signalAssociatedId !== undefined,
			remoteId: signalAssociatedId,
			signalData: signalAssociatedId !== undefined ? this.buildSDP(receiverId, 'answer') : undefined
		};
	}

	messageQueue = [];
	queueIndex = 0;
    queueInterval = 5; // 5ms = 200Hz
    batchSize = 400; // total: 400 x 200 = 80_000msg/sec
	maxQueueSize = 10000;
	queueProcessor = setInterval(() => this.#processMessageQueue(), this.queueInterval);

	#processMessageQueue() {
		const queueLength = this.messageQueue.length;
        if (queueLength === 0) return;

		if (queueLength > this.maxQueueSize) this.queueIndex += queueLength - this.maxQueueSize;
        
        const endIndex = Math.min(this.queueIndex + this.batchSize, queueLength);
        for (let i = this.queueIndex; i < endIndex; i++) {
			const [type, tInstance, data] = this.messageQueue[i];
            if (type === 'transport_data') {
                if (!tInstance) continue;
                for (const cb of tInstance.callbacks.data) cb(data);
            } else if (type === 'ws_message') {
                if (!tInstance) continue;
                for (const cb of tInstance.callbacks.message) cb(data);
                if (tInstance.onmessage) tInstance.onmessage({ data });
            }
        }
        this.queueIndex = endIndex;
        
        if (this.queueIndex < 5000) return; // Periodic cleanup, avoid memory leaks
        this.messageQueue = this.messageQueue.slice(this.queueIndex);
        this.queueIndex = 0;
    }
	enqueueWsMessage(remoteWs, message) { this.messageQueue.push(['ws_message', remoteWs, message]); }
	enqueueTransportData(transportInstance, data) { this.messageQueue.push(['transport_data', transportInstance, data]); }
}
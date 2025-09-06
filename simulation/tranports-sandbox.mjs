/**
 * Sandbox for testing WebSocket and transport connections.
 * 
 * @typedef {import('./test-transports.mjs').TestWsConnection} TestWsConnection
 * @typedef {import('./test-transports.mjs').TestWsServer} TestWsServer
 * @typedef {import('./test-transports.mjs').TestTransport} TestTransport
 */

/**
 * @typedef {Object} SignalData
 * @property {string} transportId
 * @property {number} expiration
 * @property {'offer' | 'answer'} type
 * @property {Object} sdp
 * @property {string} sdp.id
 */

export class Sandbox {
	// --- ICE SIMULATION ---
	SIGNAL_OFFER_TIMEOUT = 10_000;
	SIGNAL_ANSWER_TIMEOUT = 5_000;
	/** @type {Record<string, object>} */ PENDING_OFFERS = {}; // key: id, value: signalData
	/** @type {Record<string, object>} */ PENDING_ANSWERS = {}; // key: id, value: signalData
	cleanupInterval = setInterval(() => this.#cleanupExpiredSignals(), 2000);

	buildSDP(id, type = 'offer') {
		if (this.PENDING_OFFERS[id] || this.PENDING_ANSWERS[id]) return null; // already exists

		const timeout = type === 'offer' ? this.SIGNAL_OFFER_TIMEOUT : this.SIGNAL_ANSWER_TIMEOUT || 10_000;
		const signalData = {
			transportId: id,
			expiration: Date.now() + timeout,
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

		if (type === 'offer') this.PENDING_OFFERS[id] = signalData;
		else if (type === 'answer') this.PENDING_ANSWERS[id] = signalData;

		return signalData;
	}
	/** @param {SignalData} signalData @param {string} receiverId */
	digestSignal(signalData, receiverId) {
		const result = { success: false, signalData: null, reason: 'na' };
		const { transportId, type, sdp } = signalData;
		if (type !== 'answer' && type !== 'offer') {
			result.reason = `Invalid signal type: ${type}. Expected 'offer' or 'answer'.`;
			return result;
		}
			
		const receiver = this.transportInstances[receiverId];
		if (transportId === undefined || receiver === undefined) {
			result.reason = transportId === undefined ? `No pending ${type} found with signal ID: ${sdp.id}` : `No transport instance found for receiver ID: ${receiverId}`;
			return result;
		}

		if (type === 'offer' && Math.random() < .6) { // 60% offer use failure in simulation
			result.reason = `Simulated failure for 'offer' signal from ${transportId} to ${receiverId}`;
			return result;
		} else if (Math.random() < .2) { // 20% answer use failure in simulation
			result.reason = `Simulated failure for 'answer' signal from ${transportId} to ${receiverId}`;
			return result;
		}

		result.success = true;
		if (type === 'offer') {
			result.signalData = this.buildSDP(receiverId, 'answer');
			if (result.signalData) return result; 
			result.success = false;
			result.reason = `Failed to create answer signal for receiver ID: ${receiverId}`;
		} else {
			const linkFailureMessage = this.#linkInstances(transportId, receiverId);
			result.success = linkFailureMessage ? false : true;
			result.reason = linkFailureMessage;
		}

		return result;
	}
	#cleanupExpiredSignals() {
		const now = Date.now();
		for (const [id, entry] of Object.entries(this.PENDING_OFFERS))
			if (now > entry.expiration) delete this.PENDING_OFFERS[id];
		
		for (const [id, entry] of Object.entries(this.PENDING_ANSWERS))
			if (now > entry.expiration) delete this.PENDING_ANSWERS[id];
	}
	#linkInstances(idA, idB) {
		const [ tA, tB ] = [this.transportInstances[idA], this.transportInstances[idB]];
		if (!tA || !tB) return `One of the transport instances is missing: ${idA}=>${!!tA}, ${idB}=>${!!tB}`;
		if (tB.initiator && tA.initiator) return `Both transport instances cannot be initiators: ${idA}, ${idB}`;
		if (tA.closing || tB.closing) return `One of the transport instances is closing: ${idA}=>${tA.closing}, ${idB}=>${tB.closing}`;
		if (this.connections[idA]) return `Transport instance ${idA} is already connected to its remote ID: ${this.connections[idA].id}`;
		if (this.connections[idB]) return `Transport instance ${idB} is already connected to its remote ID: ${this.connections[idB].id}`;

		// LINK THEM
		tA.remoteId = idB;
		tB.remoteId = idA;
		this.connections[idA] = tB;
		this.connections[idB] = tA;
		tA.callbacks.connect.forEach(cb => cb()); // emit connect event for transportInstance A
		tB.callbacks.connect.forEach(cb => cb()); // emit connect event for transportInstance B

		// CONSUME SIGNALS
		this.#destroySignals(idA);
		this.#destroySignals(idB);
	}
	#destroySignals(transportId) {
		delete this.PENDING_OFFERS[transportId];
		delete this.PENDING_ANSWERS[transportId];
	}

	// --- WEBSOCKET SIMULATION ---
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

	// --- SimplePeer(WebRTC) SIMULATION ---
	globalIndex = 0; // index to attribute transportInstances IDs
	/** @type {Record<string, TestTransport>} */ connections = {};
	/** @type {Record<string, TestTransport>} */ transportInstances = {};
	inscribeInstance(transportInstance) {
		const transportId = this.globalIndex++;
		this.transportInstances[transportId] = transportInstance;
		return transportId;
	}
	sendData(fromId, toId, data) {
		if (fromId === undefined) return { success: false, reason: `Cannot send message from id: ${fromId}` };
		if (toId === undefined) return { success: false, reason: `Cannot send message to id: ${toId}` };
		
		const remoteInstance = this.connections[fromId];
		if (!remoteInstance) return { success: false, reason: `No transport instance found for id: ${fromId}` };
		if (remoteInstance.id !== toId) return { success: false, reason: `Wrong id for remoteInstance ${fromId} !== ${toId}` };
		if (remoteInstance.remoteId !== fromId) return { success: false, reason: `Transport instance ${fromId} is not linked to remoteId: ${toId}` };

		this.enqueueTransportData(remoteInstance, data);
		return { success: true, reason: 'na' };
	}
	destroyTransport(id) {
		this.#destroySignals(id);
		this.connections[id]?.close(); // close remote instance
		this.transportInstances[id]?.close(); // close local instance
		delete this.connections[id];
		delete this.transportInstances[id];
	}

	// --- MESSAGE QUEUE TO SIMULATE ASYNC BEHAVIOR ---
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
			const [type, remoteInstance, data] = this.messageQueue[i];
			if (!remoteInstance || remoteInstance.closing) continue;
            if (type === 'transport_data') {
                for (const cb of remoteInstance.callbacks.data) cb(data);
            } else if (type === 'ws_message') {
                for (const cb of remoteInstance.callbacks.message) cb(data);
                if (remoteInstance.onmessage) remoteInstance.onmessage({ data });
            }
        }
        this.queueIndex = endIndex;
        
        if (this.queueIndex < 5000) return; // Periodic cleanup, avoid memory leaks
        this.messageQueue = this.messageQueue.slice(this.queueIndex);
        this.queueIndex = 0;
    }
	enqueueWsMessage(remoteWs, message) { this.messageQueue.push(['ws_message', remoteWs, message]); }
	enqueueTransportData(remoteInstance, data) { this.messageQueue.push(['transport_data', remoteInstance, data]); }
}
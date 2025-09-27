import { CLOCK, SIMULATION, NODE, IDENTITY, GOSSIP, UNICAST, LOG_CSS } from './parameters.mjs';
import { GossipMessage } from './gossip.mjs';
import { DirectMessage, ReroutedDirectMessage } from './unicast.mjs';
import { Converter } from '../services/converter.mjs';
import { ed25519, Argon2Unified } from '../services/cryptos.mjs';

export class CryptoCodex {
	argon2 = new Argon2Unified();
	converter = new Converter();
	AVOID_CRYPTO = false;
	verbose = NODE.DEFAULT_VERBOSE;
	/** @type {string} */ id;
    /** @type {Uint8Array} */ publicKey;
    /** @type {Uint8Array} */ privateKey;

	/** @param {string} [nodeId] If provided: used to generate a fake keypair > disable crypto operations */
	constructor(nodeId) {
		if (!nodeId) return; // IF NOT PROVIDED: generate() should be called.
		this.AVOID_CRYPTO = true;
		this.id = nodeId.padEnd(IDENTITY.ID_LENGTH, ' ').slice(0, IDENTITY.ID_LENGTH);
		this.privateKey = new Uint8Array(32).fill(0); this.publicKey = new Uint8Array(32).fill(0);
		const idBytes = new TextEncoder().encode(this.id); // use nodeId to create a fake public key
		for (let i = 0; i < IDENTITY.ID_LENGTH; i++) this.publicKey[i] = idBytes[i];
	}

	// IDENTITY
	/** @param {string} id Check the first character against the PUBLIC_PREFIX */
	static isPublicNode(id) { return (IDENTITY.ARE_IDS_HEX ? Converter.hexToBits(id[0]) : id).startsWith(IDENTITY.PUBLIC_PREFIX); }
	/** @param {string} id */
	get idLength() { return IDENTITY.ARE_IDS_HEX ? IDENTITY.ID_LENGTH / 2 : IDENTITY.ID_LENGTH; }
	isPublicNode(id) { return CryptoCodex.isPublicNode(id); }
    /** @param {boolean} asPublicNode @param {Uint8Array} [seed] The privateKey. DON'T USE IN SIMULATION */
	async generate(asPublicNode, seed) { // Generate Ed25519 keypair cross-platform | set id only for simulator
		if (this.nodeId) return;
		await this.#generateAntiSybilIdentity(seed, asPublicNode);
		if (!this.id) throw new Error('Failed to generate identity');
    }
	/** Check if the pubKey meets the difficulty using Argon2 derivation @param {Uint8Array} publicKey */
	async pubkeyDifficultyCheck(publicKey) {
		if (this.AVOID_CRYPTO || !IDENTITY.DIFFICULTY) return true;
		const { bitsString } = await this.argon2.hash(publicKey, 'HiveP2P', IDENTITY.ARGON2_MEM) || {};
		if (bitsString && bitsString.startsWith('0'.repeat(IDENTITY.DIFFICULTY))) return true;
	}
	#idFromPublicKey(publicKey) {
		if (IDENTITY.ARE_IDS_HEX) return this.converter.bytesToHex(publicKey.slice(0, this.idLength), IDENTITY.ID_LENGTH);
		return this.converter.bytesToString(publicKey.slice(0, IDENTITY.ID_LENGTH));
	}
	/** @param {Uint8Array} seed The privateKey. @param {boolean} asPublicNode */
	async #generateAntiSybilIdentity(seed, asPublicNode) {
		const maxIterations = (2 ** IDENTITY.DIFFICULTY) * 100; // avoid infinite loop
		for (let i = 0; i < maxIterations; i++) { // avoid infinite loop
			const { secretKey, publicKey } = ed25519.keygen(seed);
			const id = this.#idFromPublicKey(publicKey);
			if (asPublicNode && !this.isPublicNode(id)) continue; // Check prefix
			if (!asPublicNode && this.isPublicNode(id)) continue; // Check prefix
			if (!await this.pubkeyDifficultyCheck(publicKey)) continue; // Check difficulty

			this.id = id;
			this.privateKey = secretKey; this.publicKey = publicKey;
			if (this.verbose > 2) console.log(`%cNode generated id: ${this.id} (isPublic: ${asPublicNode}, difficulty: ${IDENTITY.DIFFICULTY}) after ${((i + 1) / 2).toFixed(1)} iterations`, LOG_CSS.CRYPTO_CODEX);
			return;
		}
		if (this.verbose > 0) console.log(`%cFAILED to generate id after ${maxIterations} iterations. Try lowering the difficulty.`, LOG_CSS.CRYPTO_CODEX);
	}

	// MESSSAGE CREATION (SERIALIZATION AND SIGNATURE INCLUDED)
	signBufferViewAndAppendSignature(bufferView, privateKey, signaturePosition = bufferView.length - IDENTITY.SIGNATURE_LENGTH) {
		if (this.AVOID_CRYPTO) return;
		const dataToSign = bufferView.subarray(0, signaturePosition);
		bufferView.set(ed25519.sign(dataToSign, privateKey), signaturePosition);
	}
	/** @param {string} topic @param {string | Uint8Array | Object} data @param {number} [HOPS] @param {string[]} route @param {string[]} [neighbors] */
	createGossipMessage(topic, data, HOPS = 3, neighbors = [], timestamp = CLOCK.time) {
		const MARKER = GOSSIP.MARKERS_BYTES[topic];
		if (MARKER === undefined) throw new Error(`Failed to create gossip message: unknown topic '${topic}'.`);
		
		const neighborsBytes = this.#idsToBytes(neighbors);
		const { dataCode, dataBytes } = this.#dataToBytes(data);
		const totalBytes = 1 + 1 + 1 + 8 + 4 + 32 + neighborsBytes.length + dataBytes.length + IDENTITY.SIGNATURE_LENGTH + 1;
		const buffer = new ArrayBuffer(totalBytes);
		const bufferView = new Uint8Array(buffer);
		this.#setBufferHeader(bufferView, MARKER, dataCode, neighbors.length, timestamp, dataBytes, this.publicKey);
		
		bufferView.set(neighborsBytes, 47); 					// X bytes for neighbors
		bufferView.set(dataBytes, 47 + neighborsBytes.length); 	// X bytes for data
		bufferView.set([Math.min(255, HOPS)], totalBytes - 1); 	// 1 byte for HOPS (Unsigned)
		this.signBufferViewAndAppendSignature(bufferView, this.privateKey, totalBytes - IDENTITY.SIGNATURE_LENGTH - 1);
		return bufferView;
	}
	/** @param {Uint8Array} serializedMessage */
	decrementGossipHops(serializedMessage) { // Here we just need to decrement the HOPS value => last byte of the message
		const clone = new Uint8Array(serializedMessage); // avoid modifying the original message
		const hops = serializedMessage[serializedMessage.length - 1];
		clone[serializedMessage.length - 1] = Math.max(0, hops - 1);
		return clone;
	}
	/** @param {string} type @param {string | Uint8Array | Object} data @param {string[]} route @param {string[]} [neighbors] */
	createUnicastMessage(type, data, route, neighbors = [], timestamp = CLOCK.time) {
		const MARKER = UNICAST.MARKERS_BYTES[type];
		if (MARKER === undefined) throw new Error(`Failed to create unicast message: unknown type '${type}'.`);
		if (route.length < 2) throw new Error('Failed to create unicast message: route must have at least 2 nodes (next hop and target).');
		if (route.length > UNICAST.MAX_HOPS) throw new Error(`Failed to create unicast message: route exceeds max hops (${UNICAST.MAX_HOPS}).`);
		
		const neighborsBytes = this.#idsToBytes(neighbors);
		const { dataCode, dataBytes } = this.#dataToBytes(data);
		const routeBytes = this.#idsToBytes(route);
		const totalBytes = 1 + 1 + 1 + 8 + 4 + 32 + neighborsBytes.length + 1 + routeBytes.length + dataBytes.length + IDENTITY.SIGNATURE_LENGTH;
		const buffer = new ArrayBuffer(totalBytes);
		const bufferView = new Uint8Array(buffer);
		this.#setBufferHeader(bufferView, MARKER, dataCode, neighbors.length, timestamp, dataBytes, this.publicKey);
		
		const NDBL = neighborsBytes.length + dataBytes.length;
		bufferView.set(neighborsBytes, 47); 					// X bytes for neighbors
		bufferView.set(dataBytes, 47 + neighborsBytes.length); 	// X bytes for data
		bufferView.set([route.length], 47 + NDBL);				// 1 byte for route length
		bufferView.set(routeBytes, 47 + 1 + NDBL);				// X bytes for route

		this.signBufferViewAndAppendSignature(bufferView, this.privateKey, totalBytes - IDENTITY.SIGNATURE_LENGTH);
		return bufferView;
	}
	/** @param {Uint8Array} serialized @param {string[]} newRoute */
	createReroutedUnicastMessage(serialized, newRoute) {
		if (newRoute.length < 2) throw new Error('Failed to create rerouted unicast message: route must have at least 2 nodes (next hop and target).');
		if (newRoute.length > UNICAST.MAX_HOPS) throw new Error(`Failed to create rerouted unicast message: route exceeds max hops (${UNICAST.MAX_HOPS}).`);
	
		const routeBytesArray = newRoute.map(id => this.converter.stringToBytes(id));
		const totalBytes = serialized.length + 32 + (IDENTITY.ID_LENGTH * routeBytesArray.length) + IDENTITY.SIGNATURE_LENGTH;
		const buffer = new ArrayBuffer(totalBytes);
		const bufferView = new Uint8Array(buffer);
		bufferView.set(serialized, 0); // original serialized message
		bufferView.set(this.publicKey, serialized.length); // 32 bytes for new public key
		for (let i = 0; i < routeBytesArray.length; i++) bufferView.set(routeBytesArray[i], serialized.length + 32 + (i * IDENTITY.ID_LENGTH)); // new route
		
		this.signBufferViewAndAppendSignature(bufferView, this.privateKey, totalBytes - IDENTITY.SIGNATURE_LENGTH);
		return bufferView;
	}
	/** @param {string[]} ids */
	#idsToBytes(ids) {
		if (IDENTITY.ARE_IDS_HEX) return this.converter.hexToBytes(ids.join(''), IDENTITY.ID_LENGTH * ids.length);
		return this.converter.stringToBytes(ids.join(''));
	}
	/** @param {string | Uint8Array | Object} data */
	#dataToBytes(data) { // typeCodes: 1=string, 2=Uint8Array, 3=JSON
		if (typeof data === 'string') return { dataCode: 1, dataBytes: this.converter.stringToBytes(data) };
		if (data instanceof Uint8Array) return { dataCode: 2, dataBytes: data };
		return { dataCode: 3, dataBytes: this.converter.stringToBytes(JSON.stringify(data)) };
	}
	/** @param {Uint8Array} bufferView @param {number} marker @param {number} dataCode @param {number} neighborsCount @param {number} timestamp @param {Uint8Array} dataBytes @param {Uint8Array} publicKey */
	#setBufferHeader(bufferView, marker, dataCode, neighborsCount, timestamp, dataBytes, publicKey) {
		const timestampBytes = this.converter.numberTo8Bytes(timestamp);
		const dataLengthBytes = this.converter.numberTo4Bytes(dataBytes.length);
		bufferView.set([marker], 0);			// 1 byte for marker
		bufferView.set([dataCode], 1);			// 1 byte for data type code
		bufferView.set([neighborsCount], 2);	// 1 byte for neighbors length
		bufferView.set(timestampBytes, 3);		// 8 bytes for timestamp
		bufferView.set(dataLengthBytes, 11);	// 4 bytes for data length
		bufferView.set(publicKey, 15);			// 32 bytes for pubkey
	}

	// MESSSAGE READING (DESERIALIZATION AND SIGNATURE VERIFICATION INCLUDED)
	/** @param {Uint8Array} publicKey @param {Uint8Array} dataToVerify @param {Uint8Array} signature */
	verifySignature(publicKey, dataToVerify, signature) {
		if (this.AVOID_CRYPTO) return true;
		return ed25519.verify(dataToVerify, signature, publicKey);
	}
	/** @param {Uint8Array} bufferView */
	readBufferHeader(bufferView, readAssociatedId = true) {
		const marker = bufferView[0]; 				// 1 byte for marker
		const dataCode = bufferView[1];				// 1 byte for data type code
		const neighborsCount = bufferView[2];		// 1 byte for neighbors length
		const tBytes = bufferView.slice(3, 11);		// 8 bytes for timestamp
		const lBytes = bufferView.slice(11, 15);	// 4 bytes for data length
		const pubkey = bufferView.slice(15, 47);	// 32 bytes for pubkey
		const associatedId = readAssociatedId ? this.#idFromPublicKey(pubkey) : null;
		const neighLength = neighborsCount * this.idLength;
		const timestamp = this.converter.bytes8ToNumber(tBytes);
		const dataLength = this.converter.bytes4ToNumber(lBytes);
		return { marker, dataCode, neighLength, timestamp, dataLength, pubkey, associatedId };
	}
	/** @param {Uint8Array | ArrayBuffer} serialized @return {GossipMessage | null } */
	readGossipMessage(serialized) {
		if (this.verbose > 3) console.log(`%creadGossipMessage ${serialized.byteLength} bytes`, LOG_CSS.CRYPTO_CODEX);
		if (this.verbose > 3) console.log(`%c${serialized}`, LOG_CSS.CRYPTO_CODEX);
		try { // 1, 1, 1, 8, 4, 32, X, 64, 1
			const { marker, dataCode, neighLength, timestamp, dataLength, pubkey, associatedId } = this.readBufferHeader(serialized);
			const topic = GOSSIP.MARKERS_BYTES[marker];
			if (topic === undefined) throw new Error(`Failed to deserialize gossip message: unknown marker byte ${d[0]}.`);
			const NDBL = neighLength + dataLength;
			const neighbors = this.#bytesToIds(serialized.slice(47, 47 + neighLength));
			const deserializedData = this.#bytesToData(dataCode, serialized.slice(47 + neighLength, 47 + NDBL));
			const signatureStart = 47 + NDBL;
			const signature = serialized.slice(signatureStart, signatureStart + IDENTITY.SIGNATURE_LENGTH);
			const HOPS = serialized[serialized.length - 1];
			const expectedEnd = signatureStart + IDENTITY.SIGNATURE_LENGTH + 1;
			const senderId = associatedId;
			return new GossipMessage(topic, timestamp, neighbors, HOPS, senderId, pubkey, deserializedData, signature, signatureStart, expectedEnd);
		} catch (error) { if (this.verbose > 1) console.warn(`Error deserializing ${topic || 'unknown'} gossip message:`, error.stack); }
		return null;
	}
	/** @param {Uint8Array | ArrayBuffer} serialized @return {DirectMessage | ReroutedDirectMessage | null} */
	readUnicastMessage(serialized) {
		if (this.verbose > 3) console.log(`%creadUnicastMessage ${serialized.byteLength} bytes`, LOG_CSS.CRYPTO_CODEX);
		if (this.verbose > 3) console.log(`%c${serialized}`, LOG_CSS.CRYPTO_CODEX);
		try { // 1, 1, 1, 8, 4, 32, X, 1, X, 64
			const { marker, dataCode, neighLength, timestamp, dataLength, pubkey } = this.readBufferHeader(serialized, false);
			const type = UNICAST.MARKERS_BYTES[marker];
			if (type === undefined) throw new Error(`Failed to deserialize unicast message: unknown marker byte ${d[0]}.`);
			const NDBL = neighLength + dataLength;
			const neighbors = this.#bytesToIds(serialized.slice(47, 47 + neighLength));
			const deserializedData = this.#bytesToData(dataCode, serialized.slice(47 + neighLength, 47 + NDBL));
			const routeLength = serialized[47 + NDBL];
			const routeBytesLength = routeLength * this.idLength;
			const signatureStart = 47 + NDBL + 1 + routeBytesLength;
			const routeBytes = serialized.slice(47 + NDBL + 1, signatureStart);
			const route = this.#bytesToIds(routeBytes);
			const initialMessageEnd = signatureStart + IDENTITY.SIGNATURE_LENGTH;
			const signature = serialized.slice(signatureStart, initialMessageEnd);
			const isPatched = (serialized.length > initialMessageEnd);

			if (!isPatched) return new DirectMessage(type, timestamp, neighbors, route, pubkey, deserializedData, signature, signatureStart, initialMessageEnd);

			const rerouterPubkey = serialized.slice(initialMessageEnd, initialMessageEnd + 32);
			const newRoute = this.#bytesToIds(serialized.slice(initialMessageEnd + 32, serialized.length - IDENTITY.SIGNATURE_LENGTH));
			const rerouterSignature = serialized.slice(serialized.length - IDENTITY.SIGNATURE_LENGTH);
			return new ReroutedDirectMessage(type, timestamp, neighbors, route, pubkey, deserializedData, signature, rerouterPubkey, newRoute, rerouterSignature, serialized.length);
		} catch (error) { if (this.verbose > 1) console.warn(`Error deserializing ${type || 'unknown'} unicast message:`, error.stack); }
		return null;
	}
	/** @param {Uint8Array} serialized */
	#bytesToIds(serialized) {
		const ids = [];
		const idLength = this.idLength;
		if (serialized.length % idLength !== 0) throw new Error('Failed to parse ids: invalid serialized length.');

		for (let i = 0; i < serialized.length / idLength; i++) {
			const idBytes = serialized.slice(i * idLength, (i + 1) * idLength);
			if (IDENTITY.ARE_IDS_HEX) ids.push(this.converter.bytesToHex(idBytes, IDENTITY.ID_LENGTH));
			else ids.push(this.converter.bytesToString(idBytes));
		}
		return ids;
	}
	/** @param {1 | 2 | 3} dataCode @param {Uint8Array} dataBytes @return {string | Uint8Array | Object} */
	#bytesToData(dataCode, dataBytes) {
		if (dataCode === 1) return this.converter.bytesToString(dataBytes);
		if (dataCode === 2) return dataBytes;
		if (dataCode === 3) return JSON.parse(this.converter.bytesToString(dataBytes));
		throw new Error(`Failed to parse data: unknown data code '${dataCode}'.`);
	}
}
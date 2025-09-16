import { SIMULATION, NODE, IDENTITY, GOSSIP, UNICAST } from './global_parameters.mjs';
import { GossipMessage } from './gossip.mjs';
import { DirectMessage, ReroutedDirectMessage } from './unicast.mjs';
const [ed, {sha512}] = await Promise.all([
    import(NODE.IS_BROWSER ? 'https://unpkg.com/@noble/ed25519@3.0.0/index.js' : '@noble/ed25519'),
    import(NODE.IS_BROWSER ? 'https://unpkg.com/@noble/hashes@1.4.0/sha2.js' : '@noble/hashes/sha2.js')
]);
ed.hashes.sha512 = sha512;
const { sign, verify, keygen, getPublicKey } = ed;
function fakeKeygen(nodeId = 'toto') { // Fake keygen for simulation only, require nodeId.
	const fakePrivateKey = new Uint8Array(32).fill(0);
	const fakePublicKey = new Uint8Array(32).fill(0);
	const id = nodeId.padEnd(IDENTITY.ID_LENGTH, ' ').slice(0, IDENTITY.ID_LENGTH);
	const idBytes = Converter.stringToBytes(id); // use nodeId to create a fake public key
	for (let i = 0; i < IDENTITY.ID_LENGTH; i++) fakePublicKey[i] = idBytes[i];
	return { secretKey: fakePrivateKey, publicKey: fakePublicKey };
}

export class CryptoIdCard {
    /** @type {string} */ id;
    /** @type {Uint8Array} */ publicKey;
    /** @type {Uint8Array} */ privateKey;

    constructor(id, publicKey, privateKey) {
        this.id = id;
        this.publicKey = publicKey;
        this.privateKey = privateKey;
    }

    sign(message) { return sign(message, this.privateKey); }
    //verifySignature(signature, message) { return verify(signature, message, this.publicKey); }
	
	/** @param {Uint8Array} publicKey */
    static idFromPublicKey(publicKey) { return Converter.bytesToString(publicKey.slice(0, IDENTITY.ID_LENGTH)); }
	/** @param {Uint8Array} signature @param {Uint8Array} message @param {Uint8Array} publicKey */
	static verifySignature(signature, message, publicKey) { return verify(signature, message, publicKey); }
    static generate(nodeId = 'toto') { // Generate Ed25519 keypair cross-platform | set id only for simulator
        if (SIMULATION.AVOID_CRYPTO) {
			const id = nodeId.padEnd(IDENTITY.ID_LENGTH, ' ').slice(0, IDENTITY.ID_LENGTH);
			const { secretKey, publicKey } = fakeKeygen(nodeId);
			return new CryptoIdCard(id, publicKey, secretKey);
		}

		const { secretKey, publicKey } = keygen();
		const id = CryptoIdCard.idFromPublicKey(publicKey);
        return new CryptoIdCard(id, publicKey, secretKey);
    }
}

class Converter {
	/** Number should be between 0 and 4294967295 @param {number} num - Integer to convert to 4 bytes Uint8Array */
    static numberTo4Bytes(num) { const buffer = new ArrayBuffer(4); new DataView(buffer).setUint32(0, num, true); return new Uint8Array(buffer); }
	/** Number should be between 0 and 18446744073709551615 @param {number} num - Integer to convert to 8 bytes Uint8Array */
	static numberTo8Bytes(num) { const buffer = new ArrayBuffer(8); new DataView(buffer).setBigUint64(0, BigInt(num), true); return new Uint8Array(buffer); }
	static stringToBytes(str = 'toto') { return new TextEncoder().encode(str); }
	/** @param {Uint8Array} uint8Array - Uint8Array to convert to number */
    static bytes4ToNumber(uint8Array) { return new DataView(uint8Array.buffer, uint8Array.byteOffset, 4).getUint32(0, true); }
    /** @param {Uint8Array} uint8Array - Uint8Array to convert to number */
    static bytes8ToNumber(uint8Array) { return Number(new DataView(uint8Array.buffer, uint8Array.byteOffset, 8).getBigUint64(0, true)); }
	/** @param {Uint8Array} uint8Array - Uint8Array to convert to string */
	static bytesToString(uint8Array) { return new TextDecoder().decode(uint8Array); }
}
export class CryptoCodec {
	verbose = NODE.DEFAULT_VERBOSE;
	idCard;

	/** @param {CryptoIdCard} [idCard] */
	constructor(idCard) { this.idCard = idCard; }

	signBufferViewAndAppendSignature(bufferView, privateKey, signaturePosition = bufferView.length - IDENTITY.SIGNATURE_LENGTH) {
		if (SIMULATION.AVOID_CRYPTO) return; // do nothing
		const dataToSign = bufferView.subarray(0, signaturePosition);
		const signature = sign(dataToSign, privateKey);
		bufferView.set(signature, signaturePosition);
	}
	/** @param {string | Uint8Array | Object} data */
	#dataToBytes(data) { // typeCodes: 1=string, 2=Uint8Array, 3=JSON
		if (typeof data === 'string') return { dataCode: 1, dataBytes: Converter.stringToBytes(data) };
		if (data instanceof Uint8Array) return { dataCode: 2, dataBytes: data };
		return { dataCode: 3, dataBytes: Converter.stringToBytes(JSON.stringify(data)) };
	}
	/** @param {Uint8Array} bufferView @param {number} marker @param {number} dataCode @param {number} timestamp @param {Uint8Array} dataBytes @param {Uint8Array} publicKey */
	#setBufferHeader(bufferView, marker, dataCode, timestamp, dataBytes, publicKey) {
		const timestampBytes = Converter.numberTo8Bytes(timestamp);
		const dataLengthBytes = Converter.numberTo4Bytes(dataBytes.length);
		// 1, 1, 8, 4, 32
		bufferView.set([marker], 0);			// 1 byte for marker
		bufferView.set([dataCode], 1);			// 1 byte for data type code
		bufferView.set(timestampBytes, 2);		// 8 bytes for timestamp
		bufferView.set(dataLengthBytes, 10);	// 4 bytes for data length
		bufferView.set(publicKey, 14);			// 32 bytes for pubkey
	}
	/** @param {string} topic @param {string | Uint8Array | Object} data @param {number} [HOPS] @return {Uint8Array} */
	createGossipMessage(topic, data, HOPS = 3, timestamp = Date.now()) {
		const MARKER = GOSSIP.MARKERS_BYTES[topic];
		if (MARKER === undefined) throw new Error(`Failed to create gossip message: unknown topic '${topic}'.`);
		
		// 1, 1, 8, 4, 32, X, 64, 1
		const { dataCode, dataBytes } = this.#dataToBytes(data);
		const { publicKey, privateKey } = this.idCard;
		const totalBytes = 1 + 1 + 8 + 4 + 32 + dataBytes.length + IDENTITY.SIGNATURE_LENGTH + 1;
		const buffer = new ArrayBuffer(totalBytes);
		const bufferView = new Uint8Array(buffer);
		this.#setBufferHeader(bufferView, MARKER, dataCode, timestamp, dataBytes, publicKey);
		bufferView.set(dataBytes, 46); 			// X bytes for data
		// DONT SET HOPS BEFORE SIGNATURE 		=> will be changed on any relaying operation

		this.signBufferViewAndAppendSignature(bufferView, privateKey, totalBytes - IDENTITY.SIGNATURE_LENGTH - 1);
		bufferView.set([Math.min(255, HOPS)], totalBytes - 1); // 1 byte for HOPS (Unsigned)
		if (this.verbose > 3) console.log('creaGossipMessage', bufferView);
		return bufferView;
	}
	/** Decrement the HOPS value in a serialized gossip message @param {Uint8Array} serializedMessage */
	decrementGossipHops(serializedMessage) { // Here we just need to decrement the HOPS value => last byte of the message
		const clone = new Uint8Array(serializedMessage); // avoid modifying the original message
		const hops = serializedMessage[serializedMessage.length - 1];
		clone[serializedMessage.length - 1] = Math.max(0, hops - 1);
		return clone;
	}
	/** @param {string} type @param {string | Uint8Array | Object} data @param {string[]} route */
	createUnicastMessage(type, data, route, timestamp = Date.now()) {
		const MARKER = UNICAST.MARKERS_BYTES[type];
		if (MARKER === undefined) throw new Error(`Failed to create unicast message: unknown type '${type}'.`);
		if (route.length < 2) throw new Error('Failed to create unicast message: route must have at least 2 nodes (next hop and target).');
		if (route.length > UNICAST.MAX_HOPS) throw new Error(`Failed to create unicast message: route exceeds max hops (${UNICAST.MAX_HOPS}).`);
		
		// 1, 1, 8, 4, 32, X, 1, X, 64
		const routeBytes = Converter.stringToBytes(route.join(''));
		const { dataCode, dataBytes } = this.#dataToBytes(data);
		const { publicKey, privateKey } = this.idCard;
		const totalBytes = 1 + 1 + 8 + 4 + 32 + 1 + routeBytes.length + dataBytes.length + IDENTITY.SIGNATURE_LENGTH;
		const buffer = new ArrayBuffer(totalBytes);
		const bufferView = new Uint8Array(buffer);
		this.#setBufferHeader(bufferView, MARKER, dataCode, timestamp, dataBytes, publicKey);
		bufferView.set(dataBytes, 46); // X bytes for data
		bufferView.set([route.length], 46 + dataBytes.length); // 1 byte for route length
		bufferView.set(routeBytes, 46 + 1 + dataBytes.length); // X bytes for route

		this.signBufferViewAndAppendSignature(bufferView, privateKey, totalBytes - IDENTITY.SIGNATURE_LENGTH);
		if (this.verbose > 3) console.log('creaUnicastMessage', bufferView);
		return bufferView;
	}
	/** @param {Uint8Array} serialized @param {string[]} newRoute */
	createReroutedUnicastMessage(serialized, newRoute) {
		if (newRoute.length < 2) throw new Error('Failed to create rerouted unicast message: route must have at least 2 nodes (next hop and target).');
		if (newRoute.length > UNICAST.MAX_HOPS) throw new Error(`Failed to create rerouted unicast message: route exceeds max hops (${UNICAST.MAX_HOPS}).`);
	
		const { publicKey, privateKey } = this.idCard;
		const routeBytesArray = newRoute.map(id => Converter.stringToBytes(id));
		const totalBytes = serialized.length + 32 + (IDENTITY.ID_LENGTH * routeBytesArray.length) + IDENTITY.SIGNATURE_LENGTH;
		const buffer = new ArrayBuffer(totalBytes);
		const bufferView = new Uint8Array(buffer);
		bufferView.set(serialized, 0); // original serialized message
		bufferView.set(publicKey, serialized.length); // 32 bytes for new public key
		for (let i = 0; i < routeBytesArray.length; i++) bufferView.set(routeBytesArray[i], serialized.length + 32 + (i * IDENTITY.ID_LENGTH)); // new route
		this.signBufferViewAndAppendSignature(bufferView, privateKey, totalBytes - IDENTITY.SIGNATURE_LENGTH);
		return bufferView;
	}
	/** @param {1 | 2 | 3} dataCode @param {Uint8Array} dataBytes @return {string | Uint8Array | Object} */
	#bytesToData(dataCode, dataBytes) {
		if (dataCode === 1) return Converter.bytesToString(dataBytes);
		if (dataCode === 2) return dataBytes;
		if (dataCode === 3) return JSON.parse(Converter.bytesToString(dataBytes));
		throw new Error(`Failed to parse data: unknown data code '${dataCode}'.`);
	}
	/** @param {Uint8Array} bufferView */
	readBufferHeader(bufferView) {
		const marker = bufferView[0]; 				// 1 byte for marker
		const dataCode = bufferView[1];				// 1 byte for data type code
		const tBytes = bufferView.slice(2, 10);		// 8 bytes for timestamp
		const lBytes = bufferView.slice(10, 14);	// 4 bytes for data length
		const pubkey = bufferView.slice(14, 46);	// 32 bytes for pubkey
		const timestamp = Converter.bytes8ToNumber(tBytes); 
		const dataLength = Converter.bytes4ToNumber(lBytes);
		const data = bufferView.slice(46, 46 + dataLength); // read X bytes of data
		return { marker, dataCode, timestamp, dataLength, pubkey, data };
	}
	/** @param {Uint8Array | ArrayBuffer} serialized @return {GossipMessage | null } */
	readGossipMessage(serialized) {
		if (this.verbose > 3) console.log('readGossipMessage', serialized);
		try { // 1, 1, 8, 4, 32, X, 64, 1
			const { marker, dataCode, timestamp, dataLength, pubkey, data } = this.readBufferHeader(new Uint8Array(serialized));
			const topic = GOSSIP.MARKERS_BYTES[marker];
			if (topic === undefined) throw new Error(`Failed to deserialize gossip message: unknown marker byte ${d[0]}.`);
			const deserializedData = this.#bytesToData(dataCode, data);
			const signature = serialized.slice(46 + dataLength, 46 + dataLength + IDENTITY.SIGNATURE_LENGTH);
			const HOPS = serialized[serialized.length - 1];
			const senderId = CryptoIdCard.idFromPublicKey(pubkey);
			return new GossipMessage(topic, timestamp, HOPS, senderId, pubkey, deserializedData, signature);
		} catch (error) { if (this.verbose > 1) console.warn(`Error deserializing ${topic || 'unknown'} gossip message:`, error.message); }
		return null;
	}
	/** @param {Uint8Array | ArrayBuffer} serialized @return {DirectMessage | ReroutedDirectMessage | null} */
	readUnicastMessage(serialized) {
		if (this.verbose > 3) console.log('readUnicastMessage', serialized);
		try { // 1, 1, 8, 4, 32, X, 1, X, 64
			const { marker, dataCode, timestamp, dataLength, pubkey, data } = this.readBufferHeader(new Uint8Array(serialized));
			const type = UNICAST.MARKERS_BYTES[marker];
			if (type === undefined) throw new Error(`Failed to deserialize unicast message: unknown marker byte ${d[0]}.`);
			const deserializedData = this.#bytesToData(dataCode, data);
			const routeLength = serialized[46 + dataLength];
			const routeBytesLength = routeLength * IDENTITY.ID_LENGTH;
			const signatureStart = 46 + dataLength + 1 + routeBytesLength;
			const routeBytes = serialized.slice(46 + dataLength + 1, signatureStart);
			const route = this.readUnicastRoute(routeBytes);
			const initialMessageEnd = signatureStart + IDENTITY.SIGNATURE_LENGTH;
			const signature = serialized.slice(signatureStart, initialMessageEnd);
			const isPatched = (serialized.length > initialMessageEnd);
			if (!isPatched) return new DirectMessage(type, timestamp, route, pubkey, deserializedData, signature);

			const rerouterPubkey = serialized.slice(initialMessageEnd, initialMessageEnd + 32);
			const newRoute = this.readUnicastRoute(serialized.slice(initialMessageEnd + 32, serialized.length - IDENTITY.SIGNATURE_LENGTH));
			const rerouterSignature = serialized.slice(serialized.length - IDENTITY.SIGNATURE_LENGTH);
			return new ReroutedDirectMessage(type, timestamp, route, pubkey, deserializedData, signature, rerouterPubkey, newRoute, rerouterSignature);
		} catch (error) { if (this.verbose > 1) console.warn(`Error deserializing ${type || 'unknown'} unicast message:`, error.message); }
		return null;
	}
	/** @param {Uint8Array} serialized */
	readUnicastRoute(serialized) {
		const route = [];
		for (let i = 0; i < serialized.length / IDENTITY.ID_LENGTH; i++) {
			const idBytes = serialized.slice(i * IDENTITY.ID_LENGTH, (i + 1) * IDENTITY.ID_LENGTH);
			route.push(Converter.bytesToString(idBytes));
		}
		return route;
	}
}
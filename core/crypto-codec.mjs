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
	const converter = new Converter();
	const fakePrivateKey = new Uint8Array(32).fill(0);
	const fakePublicKey = new Uint8Array(32).fill(0);
	const id = nodeId.padEnd(IDENTITY.ID_LENGTH, ' ').slice(0, IDENTITY.ID_LENGTH);
	const idBytes = converter.stringToBytes(id); // use nodeId to create a fake public key
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
    static idFromPublicKey(publicKey) {
		const converter = new Converter();
		return converter.bytesToString(publicKey.slice(0, IDENTITY.ID_LENGTH));
	}
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
	// DATA => BYTES
	/** Number should be between 0 and 4294967295 @param {number} num - Integer to convert to 4 bytes Uint8Array */
    numberTo4Bytes(num) {
        const buffer = new ArrayBuffer(4);
        new DataView(buffer).setUint32(0, num, true);
        return new Uint8Array(buffer);
    }
	numberTo8Bytes(num) {
        const buffer = new ArrayBuffer(8);
        new DataView(buffer).setBigUint64(0, BigInt(num), true);
        return new Uint8Array(buffer);
    }
    stringToBytes(str = 'toto') { return new TextEncoder().encode(str); }

	// BYTES => DATA
	/** @param {Uint8Array} uint8Array - Uint8Array to convert to number */
    bytes4ToNumber(uint8Array) { return new DataView(uint8Array.buffer, uint8Array.byteOffset, 4).getUint32(0, true); }
    /** @param {Uint8Array} uint8Array - Uint8Array to convert to number */
    bytes8ToNumber(uint8Array) { return Number(new DataView(uint8Array.buffer, uint8Array.byteOffset, 8).getBigUint64(0, true)); }

	/** @param {Uint8Array} uint8Array - Uint8Array to convert to string */
	bytesToString(uint8Array) { return new TextDecoder().decode(uint8Array); }
}
class ConverterHIGH_PERF {
    buffer2 = new ArrayBuffer(2);
    view2 = new DataView(this.buffer2);
    buffer4 = new ArrayBuffer(4);
    view4 = new DataView(this.buffer4);
    buffer8 = new ArrayBuffer(8);
    view8 = new DataView(this.buffer8);

    // DATA => BYTES
    /** Number should be between 0 and 65535 @param {number} num - Integer to convert to 2 bytes Uint8Array */
    numberTo2BytesUint8Array(num) {
        this.view2.setUint16(0, num, true); // true for little-endian
        return new Uint8Array(this.buffer2);
    }
    /** Number should be between 0 and 4294967295 @param {number} num - Integer to convert to 4 bytes Uint8Array */
    numberTo4Bytes(num) {
        this.view4.setUint32(0, num, true); // true for little-endian
        return new Uint8Array(this.buffer4);
    }
    numberTo8Bytes(num = 0) {
        this.view8.setBigUint64(0, BigInt(num), true);
        return new Uint8Array(this.buffer8);
    }
    stringToBytes(str = 'toto') { return new TextEncoder().encode(str); }

    // BYTES => DATA
    /** @param {Uint8Array} uint8Array - Uint8Array to convert to number */
    bytes2ToNumber(uint8Array) {
        this.view2.setUint8(0, uint8Array[0]);
        this.view2.setUint8(1, uint8Array[1]);
        return this.view2.getUint16(0, true);
    }
    /** @param {Uint8Array} uint8Array - Uint8Array to convert to number */
    bytes4ToNumber(uint8Array) {
        this.view4.setUint8(0, uint8Array[0]);
        this.view4.setUint8(1, uint8Array[1]);
        this.view4.setUint8(2, uint8Array[2]);
        this.view4.setUint8(3, uint8Array[3]);
        return this.view4.getUint32(0, true);
    }
    /** @param {Uint8Array} uint8Array - Uint8Array to convert to number */
    bytes8ToNumber(uint8Array) {
        for (let i = 0; i < 8; i++) { this.view8.setUint8(i, uint8Array[i]); }
        return Number(this.view8.getBigUint64(0, true));
    }
    /** @param {Uint8Array} uint8Array - Uint8Array to convert to string */
    bytesToString(uint8Array) { return new TextDecoder().decode(uint8Array); }
}
export class CryptoCodec {
	verbose = NODE.DEFAULT_VERBOSE;
	idCard;

	/** @param {CryptoIdCard} [idCard] */
	constructor(idCard) { this.idCard = idCard; }

	signBufferViewAndAppendSignature(bufferView, privateKey, signaturePosition = bufferView.length - IDENTITY.SIGNATURE_LENGTH) {
		const dataToSign = bufferView.subarray(0, signaturePosition);
		const signature = sign(dataToSign, privateKey);
		bufferView.set(signature, signaturePosition);
	}
	/** @param {string | Uint8Array | Object} data */
	#dataToBytes(data) { // typeCodes: 1=string, 2=Uint8Array, 3=JSON
		const converter = new Converter();
		if (typeof data === 'string') return { dataCode: 1, dataBytes: converter.stringToBytes(data) };
		if (data instanceof Uint8Array) return { dataCode: 2, dataBytes: data };
		return { dataCode: 3, dataBytes: converter.stringToBytes(JSON.stringify(data)) };
	}
	/** @param {string} topic @param {string | Uint8Array | Object} data @param {number} [HOPS] @return {Uint8Array} */
	createGossipMessage(topic, data, HOPS = 3) {
		const MARKER = GOSSIP.MARKERS_BYTES[topic];
		if (MARKER === undefined) throw new Error(`Failed to create gossip message: unknown topic '${topic}'.`);
		
		const converter = new Converter();
		const { dataCode, dataBytes } = this.#dataToBytes(data);
		const timestampBytes = converter.numberTo8Bytes(Date.now());
		const dataLengthBytes = converter.numberTo4Bytes(dataBytes.length);

		const { publicKey, privateKey } = this.idCard;
		const totalBytes = 1 + 1 + 8 + 4 + 32 + dataBytes.length + IDENTITY.SIGNATURE_LENGTH + 1;
		const buffer = new ArrayBuffer(totalBytes);
		const bufferView = new Uint8Array(buffer);
		bufferView.set([MARKER], 0); 			// 1 byte for marker
		bufferView.set([dataCode], 1); 			// 1 byte for data type code
		bufferView.set(timestampBytes, 2); 		// 8 bytes for timestamp
		bufferView.set(dataLengthBytes, 10); 	// 4 bytes for data length
		bufferView.set(publicKey, 14); 			// 32 bytes for pubkey
		bufferView.set(dataBytes, 46); 			// X bytes for data
		// DONT SET HOPS BEFORE SIGNATURE 		=> will be changed on any relaying operation

		this.signBufferViewAndAppendSignature(bufferView, privateKey, totalBytes - IDENTITY.SIGNATURE_LENGTH - 1);
		bufferView.set([HOPS], totalBytes - 1); // 1 byte for HOPS (Unsigned)
		if (this.verbose > 3) console.log('creaGossipMessage', bufferView);
		return bufferView;
	}
	/** Decrement the HOPS value in a serialized gossip message @param {Uint8Array} serializedMessage */
	decrementGossipHops(serializedMessage) { // Here we just need to decrement the HOPS value => last byte of the message
		const hops = serializedMessage[serializedMessage.length - 1];
		serializedMessage[serializedMessage.length - 1] = Math.max(0, hops - 1);
		return serializedMessage;
	}
	/** @param {string} type @param {string | Uint8Array | Object} data @param {string[]} route */
	createUnicastMessage(type, data, route) {
		const MARKER = UNICAST.MARKERS_BYTES[type];
		if (MARKER === undefined) throw new Error(`Failed to create unicast message: unknown type '${type}'.`);
		if (route.length < 2) throw new Error('Failed to create unicast message: route must have at least 2 nodes (next hop and target).');
		if (route.length > UNICAST.MAX_HOPS) throw new Error(`Failed to create unicast message: route exceeds max hops (${UNICAST.MAX_HOPS}).`);

		const converter = new Converter();
		const { dataCode, dataBytes } = this.#dataToBytes(data);
		const timestampBytes = converter.numberTo8Bytes(Date.now());
		const routeBytes = converter.stringToBytes(route.join(''));
		const dataLengthBytes = converter.numberTo4Bytes(dataBytes.length);

		const { publicKey, privateKey } = this.idCard;
		const totalBytes = 1 + 1 + 8 + 1 + 4 + 32 + routeBytes.length + dataBytes.length + IDENTITY.SIGNATURE_LENGTH;
		const buffer = new ArrayBuffer(totalBytes);
		const bufferView = new Uint8Array(buffer);
		bufferView.set([MARKER], 0);			// 1 byte for marker
		bufferView.set([dataCode], 1);			// 1 byte for data type code
		bufferView.set(timestampBytes, 2);		// 8 bytes for timestamp
		bufferView.set([route.length], 10); 	// 1 bytes for route length
		bufferView.set(dataLengthBytes, 11); 	// 4 bytes for data length
		bufferView.set(publicKey, 15); 			// 32 bytes for pubkey
		bufferView.set(routeBytes, 47); 		// X bytes for route
		bufferView.set(dataBytes, 47 + routeBytes.length); // X bytes for data

		this.signBufferViewAndAppendSignature(bufferView, privateKey, totalBytes - IDENTITY.SIGNATURE_LENGTH);
		if (this.verbose > 3) console.log('creaUnicastMessage', bufferView);
		return bufferView;
	}
	/** @param {Uint8Array} serialized @param {string[]} newRoute */
	createReroutedUnicastMessage(serialized, newRoute) {
		if (newRoute.length < 2) throw new Error('Failed to create rerouted unicast message: route must have at least 2 nodes (next hop and target).');
		if (newRoute.length > UNICAST.MAX_HOPS) throw new Error(`Failed to create rerouted unicast message: route exceeds max hops (${UNICAST.MAX_HOPS}).`);
	
		const converter = new Converter();
		const { publicKey, privateKey } = this.idCard;
		const routeBytesArray = newRoute.map(id => converter.stringToBytes(id));
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
		const converter = new Converter();
		if (dataCode === 1) return converter.bytesToString(dataBytes);
		if (dataCode === 2) return dataBytes;
		if (dataCode === 3) return JSON.parse(converter.bytesToString(dataBytes));
		throw new Error(`Failed to parse data: unknown data code '${dataCode}'.`);
	}
	/** @param {Uint8Array | ArrayBuffer} serialized @return {GossipMessage | null } */
	readGossipMessage(serialized) {
		const converter = new Converter();
		const d = new Uint8Array(serialized);
		const topic = GOSSIP.MARKERS_BYTES[d[0]];
		const dataCode = d[1];
		try {
			if (this.verbose > 3) console.log('readGossipMessage', serialized);
			if (topic === undefined) throw new Error(`Failed to deserialize gossip message: unknown marker byte ${d[0]}.`);
			
			const timestamp = converter.bytes8ToNumber(d.slice(2, 10));
			const dataLength = converter.bytes4ToNumber(d.slice(10, 14));
			const senderPubkey = d.slice(14, 46);
			const data = this.#bytesToData(dataCode, d.slice(46, 46 + dataLength));
			const signature = d.slice(46 + dataLength, 46 + dataLength + IDENTITY.SIGNATURE_LENGTH);
			const HOPS = d[d.length - 1];
			const senderId = CryptoIdCard.idFromPublicKey(senderPubkey);
			return new GossipMessage(topic, timestamp, HOPS, senderId, senderPubkey, data, signature);
		} catch (error) { if (this.verbose > 1) console.warn(`Error deserializing ${topic || 'unknown'} gossip message:`, error.message); }
		return null;
	}
	/** @param {Uint8Array | ArrayBuffer} serialized @return {DirectMessage | ReroutedDirectMessage | null} */
	readUnicastMessage(serialized) {
		const converter = new Converter();
		const d = new Uint8Array(serialized);
		const type = UNICAST.MARKERS_BYTES[d[0]];
		const dataCode = d[1];
		try {
			if (this.verbose > 3) console.log('readUnicastMessage', serialized);
			if (type === undefined) throw new Error(`Failed to deserialize unicast message: unknown marker byte ${d[0]}.`);
			// 1, 1, 8, 1, 4, 32, X, 64
			const timestamp = converter.bytes8ToNumber(d.slice(2, 10));
			const routeLength = d[10];
			const dataLength = converter.bytes4ToNumber(d.slice(11, 15));
			const pubkey = d.slice(15, 47);
			const routeByteLength = routeLength * IDENTITY.ID_LENGTH;
			const [routeStart, dataStart, dataEnd] = [47, 47 + routeByteLength, 47 + routeByteLength + dataLength];
			const route = this.readUnicastRoute(d.slice(routeStart, dataStart));
			const data = this.#bytesToData(dataCode, d.slice(dataStart, dataEnd));
			const initialMessageEnd = dataEnd + IDENTITY.SIGNATURE_LENGTH;
			const signature = d.slice(dataEnd, initialMessageEnd);

			const isPatched = (d.length > initialMessageEnd);
			if (!isPatched) return new DirectMessage(type, timestamp, route, pubkey, data, signature);

			const rerouterPubkey = d.slice(initialMessageEnd, initialMessageEnd + 32);
			const newRoute = this.readUnicastRoute(d.slice(initialMessageEnd + 32, d.length - IDENTITY.SIGNATURE_LENGTH));
			const rerouterSignature = d.slice(d.length - IDENTITY.SIGNATURE_LENGTH);
			return new ReroutedDirectMessage(type, timestamp, route, pubkey, data, signature, rerouterPubkey, newRoute, rerouterSignature);
		} catch (error) { if (this.verbose > 1) console.warn(`Error deserializing ${type || 'unknown'} unicast message:`, error.message); }
		return null;
	}
	/** @param {Uint8Array} serialized */
	readUnicastRoute(serialized) {
		const converter = new Converter();
		const route = [];
		for (let i = 0; i < serialized.length / IDENTITY.ID_LENGTH; i++) {
			const idBytes = serialized.slice(i * IDENTITY.ID_LENGTH, (i + 1) * IDENTITY.ID_LENGTH);
			route.push(converter.bytesToString(idBytes));
		}
		return route;
	}
}
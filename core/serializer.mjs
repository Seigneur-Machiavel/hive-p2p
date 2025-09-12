import { NODE, GOSSIP, UNICAST } from "./global_parameters.mjs";

export class Serializer {



	/** @param {string} senderId @param {string} topic @param {string | Uint8Array} data @param {number} timestamp @param {number} [TTL] default: 3 */
	serializeGossip(senderId, topic, data, timestamp, TTL = 3) {
		const str = JSON.stringify({ senderId, topic, data, timestamp, TTL });
		const jsonBytes = NODE.IS_BROWSER ? new TextEncoder().encode(str) : Buffer.from(str, 'utf8');
		const result = new Uint8Array(1 + jsonBytes.length);
		result.set([GOSSIP.MARKER_BYTE], 0);
		result.set(jsonBytes, 1);
		return result;
	}

	/** 
	 * @param {string[]} route @param {'signal' | 'message'} type @param {string | Uint8Array} data
	 * @param {number} timestamp @param {boolean} isFlexible */
	serializeUnicast(route, type, data, timestamp, isFlexible = false, reroutedBy = undefined) {
		const str = JSON.stringify({ route, type, data, timestamp, isFlexible, reroutedBy });
		const jsonBytes = NODE.IS_BROWSER ? new TextEncoder().encode(str) : Buffer.from(str, 'utf8');
		const result = new Uint8Array(1 + jsonBytes.length);
		result.set([UNICAST.MARKER_BYTE], 0);
		result.set(jsonBytes, 1);
		return result;
	}
	
	deserialize(serialized) {
		const uint8Array = new Uint8Array(serialized);
		if (uint8Array[0] === GOSSIP.MARKER_BYTE) return this.#deserializeGossip(uint8Array.slice(1));
		if (uint8Array[0] === UNICAST.MARKER_BYTE) return this.#deserializeUnicast(uint8Array.slice(1));
		throw new Error(`Failed to deserialize message: unknown marker byte ${uint8Array[0]}.`);
	}
	#deserializeGossip(serialized) {
		const str = NODE.IS_BROWSER ? new TextDecoder().decode(serialized) : Buffer.from(serialized).toString('utf8');
		const obj = JSON.parse(str);
		return obj;
	}
	#deserializeUnicast(serialized) {
		const str = NODE.IS_BROWSER ? new TextDecoder().decode(serialized) : Buffer.from(serialized).toString('utf8');
		const obj = JSON.parse(str);
		return obj;
	}
}
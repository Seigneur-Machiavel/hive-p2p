const base58Alphabet = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, '9': 8, 'A': 9, 'B': 10, 'C': 11, 'D': 12, 'E': 13, 'F': 14, 'G': 15, 'H': 16, 'J': 17, 'K': 18, 'L': 19, 'M': 20, 'N': 21, 'P': 22, 'Q': 23, 'R': 24, 'S': 25, 'T': 26, 'U': 27, 'V': 28, 'W': 29, 'X': 30, 'Y': 31, 'Z': 32, 'a': 33, 'b': 34, 'c': 35, 'd': 36, 'e': 37, 'f': 38, 'g': 39, 'h': 40, 'i': 41, 'j': 42, 'k': 43, 'm': 44, 'n': 45, 'o': 46, 'p': 47, 'q': 48, 'r': 49, 's': 50, 't': 51, 'u': 52, 'v': 53, 'w': 54, 'x': 55, 'y': 56, 'z': 57 };
const base58AlphabetArray = [ '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z' ];

export class Converter {
	IS_BROWSER = typeof self !== 'undefined';
	FROMBASE64_AVAILABLE = typeof Uint8Array.fromBase64 === 'function';
	textEncoder = new TextEncoder();
	textDecoder = new TextDecoder();
	buffer2 = new ArrayBuffer(2); view2 = new DataView(this.buffer2);
	buffer4 = new ArrayBuffer(4); view4 = new DataView(this.buffer4);
	buffer6 = new ArrayBuffer(6); view6 = new DataView(this.buffer6);
	buffer8 = new ArrayBuffer(8); view8 = new DataView(this.buffer8);
	hexMap = { '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'A': 10, 'B': 11, 'C': 12, 'D': 13, 'E': 14, 'F': 15, 'a': 10, 'b': 11, 'c': 12, 'd': 13, 'e': 14, 'f': 15 };

	// ... TO BYTES
	/** Number should be between 0 and 65535 @param {number} num - Integer to convert to 2 bytes Uint8Array */
	numberTo2Bytes(num) {
		this.view2.setUint16(0, num, true);
		return new Uint8Array(this.buffer2);
	}
	/** Number should be between 0 and 4294967295 @param {number} num - Integer to convert to 4 bytes Uint8Array */
	numberTo4Bytes(num) {
		this.view4.setUint32(0, num, true);
		return new Uint8Array(this.buffer4);
	}
	/** Number should be between 0 and 281474976710655 (2^48-1) @param {number} num - Integer to convert to 6 bytes Uint8Array */
	numberTo6Bytes(num) {
		this.view6.setUint32(0, num % 0x100000000, true); // lower 4 bytes
		this.view6.setUint16(4, Math.floor(num / 0x100000000), true); // upper 2 bytes
		return new Uint8Array(this.buffer6);
	}
	/** Number should be between 0 and 18446744073709551615 @param {number} num - Integer to convert to 8 bytes Uint8Array */
	numberTo8Bytes(num) {
		this.view8.setBigUint64(0, BigInt(num), true);
		return new Uint8Array(this.buffer8);
	}
	stringToBytes(str = 'toto') { return this.textEncoder.encode(str); }
	/** @param {string} hex - Hex string to convert to Uint8Array */
    hexToBytes(hex) {
        const length = hex.length / 2;
        const uint8Array = new Uint8Array(length);
        for (let i = 0, j = 0; i < length; ++i, j += 2) uint8Array[i] = (this.hexMap[hex[j]] << 4) + this.hexMap[hex[j + 1]];
        return uint8Array;
    }
	/** Base64 string to convert to Uint8Array @param {string} base64 @returns {Uint8Array} */
	base64toBytes(base64) {
		if (!this.IS_BROWSER) return new Uint8Array(Buffer.from(base64, 'base64'));
		if (this.FROMBASE64_AVAILABLE) return Uint8Array.fromBase64(base64);
		const binaryString = atob(base64);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
		return bytes;
	}

	// BYTES TO ...
	/** @param {Uint8Array} uint8Array - Uint8Array to convert to number */
    bytes2ToNumber(uint8Array) {
		for (let i = 0; i < 2; i++) this.view2.setUint8(i, uint8Array[i]);
		return this.view2.getUint16(0, true);
	}
	/** @param {Uint8Array} uint8Array - Uint8Array to convert to number */
	bytes4ToNumber(uint8Array) {
		for (let i = 0; i < 4; i++) this.view4.setUint8(i, uint8Array[i]);
		return this.view4.getUint32(0, true);
	}
	/** @param {Uint8Array} uint8Array - Uint8Array to convert to number */
	bytes6ToNumber(uint8Array) {
		for (let i = 0; i < 6; i++) this.view6.setUint8(i, uint8Array[i]);
		return this.view6.getUint32(0, true) + this.view6.getUint16(4, true) * 0x100000000;
	}
	/** @param {Uint8Array} uint8Array - Uint8Array to convert to number */
	bytes8ToNumber(uint8Array) {
		for (let i = 0; i < 8; i++) this.view8.setUint8(i, uint8Array[i]);
		return Number(this.view8.getBigUint64(0, true));
	}
	/** @param {Uint8Array} uint8Array - Uint8Array to convert to string */
	bytesToString(uint8Array) { return this.textDecoder.decode(uint8Array); }
	/** @param {Uint8Array} uint8Array - Uint8Array to convert to string */
    static bytesToHex(uint8Array, minLength = 0) {
        let hexStr = '';
        for (const byte of uint8Array) hexStr += byte < 16 ? `0${byte.toString(16)}` : byte.toString(16);
        if (minLength > 0) { hexStr = hexStr.padStart(minLength, '0'); }
        return hexStr;
    }
	/** @param {Uint8Array} uint8Array - Uint8Array to convert to string */
	bytesToHex(uint8Array, minLength = 0) { return Converter.bytesToHex(uint8Array, minLength); }

	// BASE58
	/** @param {number} num - Unsigned integer 4bytes to convert to Base58 string @param {number} [minLength] - Minimum length of the output string, padded with '1', default: 6 */
	static uint32ToB58(num, minLength = 6) {
		if (num === 0) return '1';
		
		let result = '';
		while (num > 0) {
			result = base58AlphabetArray[num % 58] + result;
			num = Math.floor(num / 58);
		}
		return result.padStart(minLength, '1');
	}
	/** @param {string} b58 - Base58 string to convert to uint32 */
	static b58ToUint32(b58) {
		let result = 0;
		for (const char of b58) result = result * 58 + base58Alphabet[char];
		return result;
	}

	// OTHERS
	/** @param {string} hex - Hex string to convert to BigInt */
    static hexToBigInt(hex) { return BigInt('0x' + hex); }
	/** @param {string} hex - Hex string to convert to bits @param {'string' | 'arrayOfString' | 'arrayOfNumbers'} format - Output format, default: string */
	static hexToBits(hex = 'ffffff', format = 'string') {
		let bitsString = []; // WE USE STRING METHODS FOR PERFORMANCE (number '0' = 8 Bytes | string '0' = 1 Byte)
		if (format === 'arrayOfNumbers') for (let i = 0; i < hex.length; i++) bitsString.push(...(parseInt(hex[i], 16).toString(2).padStart(4, '0').split('').map(b => parseInt(b, 10))));
		else for (let i = 0; i < hex.length; i++) bitsString.push(parseInt(hex[i], 16).toString(2).padStart(4, '0'));
		return format === 'string' ? bitsString.join('') : bitsString;
	}
	/** @param {Uint8Array} uint8Array - Uint8Array to convert to bits @param {'string' | 'arrayOfString' | 'arrayOfNumbers'} format - Output format, default: string */
	static bytesToBits(uint8Array, format = 'string') { return this.hexToBits(this.bytesToHex(uint8Array), format); }
	static ipToInt(ip = '192.168.0.1') { return ip.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0); }
}
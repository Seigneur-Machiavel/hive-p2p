import { Converter } from './converter.mjs';
const IS_BROWSER = typeof window !== 'undefined';

// ED25519 EXPOSURE NODEJS/BROWSER COMPATIBLE ---------------------------------
/*const [ed_, {sha512}] = await Promise.all([
    import(IS_BROWSER ? '../libs/ed25519-3.0.0.js' : '@noble/ed25519'),
    import(IS_BROWSER ? '../libs/hashes-2.0.0.js' : '@noble/hashes/sha2.js')
]);*/
import * as ed_ from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

/** @type {import('@noble/ed25519')} */
const ed25519 = ed_;
ed25519.hashes.sha512 = sha512;
export { ed25519 };
//-----------------------------------------------------------------------------

// ARGON2 EXPOSURE NODEJS/BROWSER COMPATIBLE ----------------------------------
export class Argon2Unified {
	converter = new Converter();
	/** @type {import('argon2')} */ argon2;

	/** This function hashes a password using Argon2 - Browser/NodeJS unified
	 * @param {string} pass - Password to hash
	 * @param {string} salt - Salt to use for the hash
	 * @param {number} [mem] - Memory usage in KiB, default: 2**16 = 65_536 (64 MiB) | RECOMMENDED: 2**16
	 * @param {number} [time] - Time cost in iterations, default: 1
	 * @param {number} [parallelism] - Number of threads to use, default: 1
	 * @param {number} [type] - 0: Argon2d, 1: Argon2i, 2: Argon2id, default: 2 (Argon2id)
	 * @param {number} [hashLen] - Length of the hash in bytes, default: 32 */
	hash = async (pass, salt, mem = 2**16, time = 1, parallelism = 1, type = 2, hashLen = 32) => {
		const params = this.#createArgon2Params(pass, salt, time, mem, parallelism, type, hashLen);
		const argon2Lib = await this.getArgon2Lib();
		const hashResult = IS_BROWSER ? await argon2Lib.hash(params) : await argon2Lib.hash(pass, params);
		if (!hashResult) return false;
	
		const encoded = hashResult.encoded || hashResult;
		const result = this.#standardizeArgon2FromEncoded(encoded);
		if (!result) return false;
	
		return result;
	}
	async getArgon2Lib() {
		if (this.argon2) return this.argon2;

		if (!IS_BROWSER) { try {
			const a = await import('argon2');
			this.argon2 = a;
		} catch (error) { throw new Error('Please install argon2 package: npm install argon2'); } }
		if (this.argon2) return this.argon2;

		try { if (argon2) {
			console.log('Argon2 loaded as a global variable');
			this.argon2 = argon2;
			return this.argon2;
		}} catch (error) { }
		if (this.argon2) return this.argon2;

		console.log('trying import argon2 ES6 and inject in window');
		const argon2ES6 = await import('../libs/argon2-ES6.min.mjs');
		window.argon2 = argon2ES6.default; // EXPOSE TO GLOBAL SCOPE
		this.argon2 = argon2ES6.default;
		return this.argon2;
	};
	#createArgon2Params(pass = "averylongpassword123456", salt = "saltsaltsaltsaltsalt", time = 1, mem = 2**10, parallelism = 1, type = 2, hashLen = 32) {
		const fixedSalt = salt.padEnd(20, '0').substring(0, 16); // 16 bytes minimum
		return {
			type, pass, parallelism,
			time, timeCost: time, 			// we preserve both for compatibility
			mem, memoryCost: mem, 			// we preserve both for compatibility
			hashLen, hashLength: hashLen, 	// we preserve both for compatibility
			salt: IS_BROWSER ? fixedSalt : Buffer.from(fixedSalt),
		};
	}
	#standardizeArgon2FromEncoded(encoded = '$argon2id$v=19$m=1048576,t=1,p=1$c2FsdHNhbHRzYWx0c2FsdHNhbHQ$UamPN/XTTX4quPewQNw4/s3y1JJeS22cRroh5l7OTMM') {
		const base64 = encoded.split('$').pop();
		const hash = this.converter.base64toBytes(base64);
		const hex = this.converter.bytesToHex(hash);
		/** @type {string} */
		const bitsString = Converter.hexToBits(hex, 'string');
		if (!bitsString) return false;
		return { encoded, hash, hex, bitsString };
	}
}
//-----------------------------------------------------------------------------
export class Argon2Unified {
    converter: Converter;
    /** @type {import('argon2')} */ argon2: typeof import("argon2");
    /** This function hashes a password using Argon2 - Browser/NodeJS unified
     * @param {string} pass - Password to hash
     * @param {string} salt - Salt to use for the hash
     * @param {number} [mem] - Memory usage in KiB, default: 2**16 = 65_536 (64 MiB) | RECOMMENDED: 2**16
     * @param {number} [time] - Time cost in iterations, default: 1
     * @param {number} [parallelism] - Number of threads to use, default: 1
     * @param {number} [type] - 0: Argon2d, 1: Argon2i, 2: Argon2id, default: 2 (Argon2id)
     * @param {number} [hashLen] - Length of the hash in bytes, default: 32 */
    hash: (pass: string, salt: string, mem?: number, time?: number, parallelism?: number, type?: number, hashLen?: number) => Promise<false | {
        encoded: string;
        hash: Uint8Array<ArrayBufferLike>;
        hex: string;
        bitsString: string;
    }>;
    getArgon2Lib(): Promise<typeof import("argon2")>;
    #private;
}
/** @type {import('@noble/ed25519')} */
export const ed25519: typeof ed_;
import { Converter } from './converter.mjs';
import * as ed_ from '@noble/ed25519';

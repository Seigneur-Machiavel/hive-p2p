export class CryptoCodex {
    /** @param {boolean} asPublicNode Default: false @param {Uint8Array} seed PrivateKey *-optional* */
    static createCryptoCodex(asPublicNode: boolean, seed: Uint8Array): Promise<CryptoCodex>;
    /** @param {string} id Check the first character against the PUBLIC_PREFIX */
    static isPublicNode(id: string): any;
    /** @param {string} [nodeId] If provided: used to generate a fake keypair > disable crypto operations */
    constructor(nodeId?: string, verbose?: number);
    argon2: Argon2Unified;
    converter: Converter;
    AVOID_CRYPTO: boolean;
    verbose: number;
    /** @type {string} */ id: string;
    /** @type {Uint8Array} */ publicKey: Uint8Array;
    /** @type {Uint8Array} */ privateKey: Uint8Array;
    /** @param {string} id */
    get idLength(): number;
    isPublicNode(id: any): any;
    /** @param {boolean} asPublicNode @param {Uint8Array} [seed] The privateKey. DON'T USE IN SIMULATION */
    generate(asPublicNode: boolean, seed?: Uint8Array): Promise<void>;
    /** Check if the pubKey meets the difficulty using Argon2 derivation @param {Uint8Array} publicKey */
    pubkeyDifficultyCheck(publicKey: Uint8Array): Promise<boolean>;
    signBufferViewAndAppendSignature(bufferView: any, privateKey: any, signaturePosition?: number): void;
    /** @param {string} topic @param {string | Uint8Array | Object} data @param {number} [HOPS] @param {string[]} route @param {string[]} [neighbors] */
    createGossipMessage(topic: string, data: string | Uint8Array | any, HOPS?: number, neighbors?: string[], timestamp?: any): Uint8Array<ArrayBuffer>;
    /** @param {Uint8Array} serializedMessage */
    decrementGossipHops(serializedMessage: Uint8Array): Uint8Array<ArrayBuffer>;
    /** @param {string} type @param {string | Uint8Array | Object} data @param {string[]} route @param {string[]} [neighbors] */
    createUnicastMessage(type: string, data: string | Uint8Array | any, route: string[], neighbors?: string[], timestamp?: any): Uint8Array<ArrayBuffer>;
    /** @param {Uint8Array} serialized @param {string[]} newRoute */
    createReroutedUnicastMessage(serialized: Uint8Array, newRoute: string[]): Uint8Array<ArrayBuffer>;
    /** @param {Uint8Array} publicKey @param {Uint8Array} dataToVerify @param {Uint8Array} signature */
    verifySignature(publicKey: Uint8Array, dataToVerify: Uint8Array, signature: Uint8Array): boolean;
    /** @param {Uint8Array} bufferView */
    readBufferHeader(bufferView: Uint8Array, readAssociatedId?: boolean): {
        marker: number;
        dataCode: number;
        neighLength: number;
        timestamp: number;
        dataLength: number;
        pubkey: Uint8Array<ArrayBuffer>;
        associatedId: string;
    };
    /** @param {Uint8Array | ArrayBuffer} serialized @return {GossipMessage | null } */
    readGossipMessage(serialized: Uint8Array | ArrayBuffer): GossipMessage | null;
    /** @param {Uint8Array | ArrayBuffer} serialized @return {DirectMessage | ReroutedDirectMessage | null} */
    readUnicastMessage(serialized: Uint8Array | ArrayBuffer): DirectMessage | ReroutedDirectMessage | null;
    #private;
}
import { Argon2Unified } from '../services/cryptos.mjs';
import { Converter } from '../services/converter.mjs';
import { GossipMessage } from './gossip.mjs';
import { DirectMessage } from './unicast.mjs';
import { ReroutedDirectMessage } from './unicast.mjs';

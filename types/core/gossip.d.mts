export class GossipMessage {
    /** @param {string} topic @param {number} timestamp @param {string[]} neighborsList @param {number} HOPS @param {string} senderId @param {string} pubkey @param {string | Uint8Array | Object} data @param {string | undefined} signature @param {number} signatureStart @param {number} expectedEnd */
    constructor(topic: string, timestamp: number, neighborsList: string[], HOPS: number, senderId: string, pubkey: string, data: string | Uint8Array | any, signature: string | undefined, signatureStart: number, expectedEnd: number);
    topic: string;
    timestamp: number;
    neighborsList: string[];
    HOPS: number;
    senderId: string;
    pubkey: string;
    data: any;
    signature: string;
    signatureStart: number;
    expectedEnd: number;
}
export class Gossip {
    /** @param {string} selfId @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex @param {import('./arbiter.mjs').Arbiter} arbiter @param {import('./peer-store.mjs').PeerStore} peerStore */
    constructor(selfId: string, cryptoCodex: import("./crypto-codex.mjs").CryptoCodex, arbiter: import("./arbiter.mjs").Arbiter, peerStore: import("./peer-store.mjs").PeerStore, verbose?: number);
    /** @type {Record<string, Function[]>} */ callbacks: Record<string, Function[]>;
    id: string;
    cryptoCodex: import("./crypto-codex.mjs").CryptoCodex;
    arbiter: import("./arbiter.mjs").Arbiter;
    peerStore: import("./peer-store.mjs").PeerStore;
    verbose: number;
    bloomFilter: DegenerateBloomFilter;
    /** @param {string} callbackType @param {Function} callback */
    on(callbackType: string, callback: Function): void;
    /** Gossip a message to all connected peers > will be forwarded to all peers
     * @param {string | Uint8Array | Object} data @param {string} topic @param {number} [HOPS] */
    broadcastToAll(data: string | Uint8Array | any, topic?: string, HOPS?: number): void;
    sendGossipHistoryToPeer(peerId: any): void;
    /** @param {string} from @param {Uint8Array} serialized @returns {void} */
    handleGossipMessage(from: string, serialized: Uint8Array): void;
    #private;
}
/**
 * - 'BloomFilterCacheEntry' Definition
 */
export type BloomFilterCacheEntry = {
    hash: string;
    senderId: string;
    topic: string;
    serializedMessage: Uint8Array;
    expiration: number;
};
/** - 'BloomFilterCacheEntry' Definition
 * @typedef {Object} BloomFilterCacheEntry
 * @property {string} hash
 * @property {string} senderId
 * @property {string} topic
 * @property {Uint8Array} serializedMessage
 * @property {number} expiration
 */
declare class DegenerateBloomFilter {
    /** @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex */
    constructor(cryptoCodex: import("./crypto-codex.mjs").CryptoCodex);
    cryptoCodex: import("./crypto-codex.mjs").CryptoCodex;
    xxHash32UsageCount: number;
    /** @type {Record<string, number>} */
    seenTimeouts: Record<string, number>;
    /** @type {BloomFilterCacheEntry[]} */ cache: BloomFilterCacheEntry[];
    cleanupFrequency: number;
    cleanupIn: number;
    cleanupDurationWarning: number;
    /** @param {'asc' | 'desc'} order */
    getGossipHistoryByTime(order?: "asc" | "desc"): {
        senderId: string;
        topic: string;
        data: Uint8Array<ArrayBufferLike>;
    }[];
    /** @param {Uint8Array} serializedMessage */
    addMessage(serializedMessage: Uint8Array): {
        hash: number;
        isNew: boolean;
    };
    #private;
}
export {};

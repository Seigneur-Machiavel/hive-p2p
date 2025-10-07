export namespace TRUST_VALUES {
    let VALID_SIGNATURE: number;
    let VALID_POW: number;
    let UNICAST_RELAYED: number;
    let WRONG_SIGNATURE: number;
    let WRONG_POW: number;
    let WRONG_SERIALIZATION: number;
    let GOSSIP_FLOOD: number;
    let UNICAST_FLOOD: number;
    let HOPS_EXCEEDED: number;
    let UNICAST_INVALID_ROUTE: number;
    let FAILED_HANDSHAKE: number;
    let WRONG_LENGTH: number;
}
export class Arbiter {
    /** @param {string} selfId @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex @param {number} verbose */
    constructor(selfId: string, cryptoCodex: import("./crypto-codex.mjs").CryptoCodex, verbose?: number);
    id: string;
    cryptoCodex: import("./crypto-codex.mjs").CryptoCodex;
    verbose: number;
    /** - Key: peerId,  Value: trustBalance
     * - trustBalance = milliseconds of ban if negative
     * @type {Record<string, number>} */
    trustBalances: Record<string, number>;
    bytesCounters: {
        gossip: number;
        unicast: number;
    };
    bytesCounterResetIn: number;
    tick(): void;
    /** Call from HiveP2P module only!
     * @param {string} peerId
     * @param {'WRONG_SERIALIZATION'} action */
    countPeerAction(peerId: string, action: "WRONG_SERIALIZATION"): void;
    /** @param {string} peerId @param {number} delta @param {string} [reason] */
    adjustTrust(peerId: string, delta: number, reason?: string): void;
    isBanished(peerId?: string): boolean;
    /** @param {string} peerId @param {number} byteLength @param {'gossip' | 'unicast'} type */
    countMessageBytes(peerId: string, byteLength: number, type: "gossip" | "unicast"): true | void;
    /** Call from HiveP2P module only! @param {string} from @param {any} message @param {Uint8Array} serialized @param {number} [powCheckFactor] default: 0.01 (1%) */
    digestMessage(from: string, message: any, serialized: Uint8Array, powCheckFactor?: number): Promise<void>;
    #private;
}

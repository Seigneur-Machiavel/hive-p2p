export class MessageQueue {
    /** @param {Function} onMessage */
    constructor(onMessage: Function);
    /** @type {Record<string, any>} */
    messageQueuesByTypes: Record<string, any>;
    onMessage: Function;
    push(message: any): void;
    tick(): Promise<void>;
}
export class Statician {
    /** @param {Object} sVARS @param {Record<string, Record<string, import('../core/node.mjs').Node>>} peers @param {number} verbose @param {number} [delay] default: 10 seconds */
    constructor(sVARS: any, peers: Record<string, Record<string, import("../core/node.mjs").Node>>, delay?: number);
    gossip: number;
    unicast: number;
    #private;
}
export class TransmissionAnalyzer {
    /** @param {Record<string, Record<string, import('../core/node.mjs').Node>>} peers @param {number} verbose @param {number} [delay] default: 10 seconds */
    constructor(sVARS: any, peers: Record<string, Record<string, import("../core/node.mjs").Node>>, verbose: number, delay?: number);
    verbose: number;
    sVARS: any;
    peers: Record<string, Record<string, import("../core/node.mjs").Node>>;
    gossip: {
        /** @type {Map<string, { time: number, count: number, hops: number} }>} */
        receptions: Map<string, {
            time: number;
            count: number;
            hops: number;
        }>;
        nonce: string;
        sendAt: number;
    };
    /** @param {string} receiverId @param {string} nonce @param {number} HOPS  */
    analyze(receiverId: string, nonce: string, HOPS: number): void;
    #private;
}
export class SubscriptionsManager {
    /** @param {Function} sendFnc @param {Record<string, import('../core/node.mjs').Node>} peers @param {import('../core/crypto-codex.mjs').CryptoCodex} cryptoCodex @param {number} verbose @param {number} [delay] default: 10 seconds */
    constructor(sendFnc: Function, peers: Record<string, import("../core/node.mjs").Node>, cryptoCodex: import("../core/crypto-codex.mjs").CryptoCodex, verbose: number, delay?: number);
    verbose: number;
    cryptoCodex: CryptoCodex;
    /** @type {Function} */ sendFnc: Function;
    /** @type {Record<string, Record<string, import('../core/node.mjs').Node>} */ peers: Record<string, Record<string, import("../core/node.mjs").Node>>;
    unicastCount: {
        session: number;
        total: number;
    };
    gossipCount: {
        session: number;
        total: number;
    };
    tmpTopic: {};
    tmpType: {};
    mpTopic: {};
    mpType: {};
    unicastBandwidth: {
        session: number;
        total: number;
    };
    gossipBandwidth: {
        session: number;
        total: number;
    };
    tbTopic: {};
    tbType: {};
    bTopic: {};
    bType: {};
    onPeerMessage: any;
    interval: NodeJS.Timeout;
    setPeerMessageListener(peerId: any): boolean;
    #private;
}
import { CryptoCodex } from '../core/crypto-codex.mjs';

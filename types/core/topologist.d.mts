export class Topologist {
    /** @param {string} selfId @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex @param {import('./gossip.mjs').Gossip} gossip @param {import('./unicast.mjs').UnicastMessager} messager @param {import('./peer-store.mjs').PeerStore} peerStore @param {string[]} bootstraps */
    constructor(selfId: string, cryptoCodex: import("./crypto-codex.mjs").CryptoCodex, gossip: import("./gossip.mjs").Gossip, messager: import("./unicast.mjs").UnicastMessager, peerStore: import("./peer-store.mjs").PeerStore, bootstraps: string[]);
    id: string;
    cryptoCodex: import("./crypto-codex.mjs").CryptoCodex;
    gossip: import("./gossip.mjs").Gossip;
    messager: import("./unicast.mjs").UnicastMessager;
    peerStore: import("./peer-store.mjs").PeerStore;
    bootstraps: string[];
    offersQueue: OfferQueue;
    /** @type {Map<string, boolean>} */ bootstrapsConnectionState: Map<string, boolean>;
    /** @type {import('./node-services.mjs').NodeServices | undefined} */ services: import("./node-services.mjs").NodeServices | undefined;
    /** @type {number} */ NEIGHBORS_TARGET: number;
    /** @type {number} */ HALF_TARGET: number;
    /** @type {number} */ TWICE_TARGET: number;
    setNeighborsTarget(count?: number): void;
    phase: number;
    nextBootstrapIndex: number;
    maxBonus: number;
    get isPublicNode(): boolean;
    tick(): void;
    /** @param {string} peerId @param {SignalData} data @param {number} [HOPS] */
    handleIncomingSignal(senderId: any, data: SignalData, HOPS?: number): void;
    tryConnectNextBootstrap(neighborsCount?: number, nonPublicNeighborsCount?: number): void;
    #private;
}
export type SignalData = {
    neighbors: Array<string>;
    signal: {
        type: "offer" | "answer";
        sdp: string;
    };
    offerHash?: string;
};
export type OfferQueueItem = {
    senderId: string;
    data: SignalData;
    overlap: number;
    neighborsCount: number;
    timestamp: number;
};
/**
 * @typedef {Object} SignalData
 * @property {Array<string>} neighbors
 * @property {Object} signal
 * @property {'offer' | 'answer'} signal.type
 * @property {string} signal.sdp
 * @property {string} [offerHash]
 *
 * @typedef {Object} OfferQueueItem
 * @property {string} senderId
 * @property {SignalData} data
 * @property {number} overlap
 * @property {number} neighborsCount
 * @property {number} timestamp
 * */
declare class OfferQueue {
    maxOffers: number;
    /** @type {Array<OfferQueueItem>} */ offers: Array<OfferQueueItem>;
    /** @type {'overlap' | 'neighborsCount'} */ orderingBy: "overlap" | "neighborsCount";
    get size(): number;
    updateOrderingBy(isHalfTargetReached?: boolean): void;
    removeOlderThan(age?: number): void;
    get bestOfferInfo(): {
        senderId: string;
        data: SignalData;
        timestamp: number;
        value: number;
    };
    /** @param {OfferQueueItem} offer @param {boolean} isHalfTargetReached @param {{min: number, max: number}} [ignoringFactors] */
    pushSortTrim(offer: OfferQueueItem, ignoringFactors?: {
        min: number;
        max: number;
    }): void;
}
export {};

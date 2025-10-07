/** - 'OfferObj' Definition
 * @typedef {Object} OfferObj
 * @property {number} timestamp
 * @property {boolean} isUsed // => if true => should be deleted
 * @property {number} sentCounter
 * @property {Object} signal
 * @property {import('simple-peer').Instance} offererInstance
 * @property {boolean} isDigestingOneAnswer Flag to avoid multiple answers handling at the same time (DISCOVERY.LOOP_DELAY (2.5s) will be doubled (5s) between two answers handling)
 * @property {Array<{peerId: string, signal: any, timestamp: number, used: boolean}>} answers
 * @property {Record<string, boolean>} answerers key: peerId, value: true */
export class OfferManager {
    /** @param {string} id @param {Array<{urls: string}>} stunUrls */
    constructor(id: string, stunUrls: Array<{
        urls: string;
    }>, verbose?: number);
    id: string;
    verbose: number;
    stunUrls: {
        urls: string;
    }[];
    onSignalAnswer: any;
    onConnect: any;
    /** @type {Record<number, import('simple-peer').Instance>} key: expiration timestamp */
    offerInstanceByExpiration: Record<number, any>;
    creatingOffer: boolean;
    offerCreationTimeout: any;
    offersToCreate: number;
    /** @type {Record<string, OfferObj>} key: offerHash **/ offers: Record<string, OfferObj>;
    tick(): void;
    /** @param {string} remoteId @param {{type: 'answer', sdp: Record<string, string>}} signal @param {string} offerHash @param {number} timestamp receptionTimestamp */
    addSignalAnswer(remoteId: string, signal: {
        type: "answer";
        sdp: Record<string, string>;
    }, offerHash: string, timestamp: number): void;
    /** @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} signal @param {string} [offerHash] offer only */
    getTransportInstanceForSignal(remoteId: string, signal: {
        type: "offer" | "answer";
        sdp: Record<string, string>;
    }, offerHash?: string): any;
    destroy(): void;
    #private;
}
/**
 * - 'OfferObj' Definition
 */
export type OfferObj = {
    timestamp: number;
    /**
     * // => if true => should be deleted
     */
    isUsed: boolean;
    sentCounter: number;
    signal: any;
    offererInstance: any;
    /**
     * Flag to avoid multiple answers handling at the same time (DISCOVERY.LOOP_DELAY (2.5s) will be doubled (5s) between two answers handling)
     */
    isDigestingOneAnswer: boolean;
    answers: Array<{
        peerId: string;
        signal: any;
        timestamp: number;
        used: boolean;
    }>;
    /**
     * key: peerId, value: true
     */
    answerers: Record<string, boolean>;
};

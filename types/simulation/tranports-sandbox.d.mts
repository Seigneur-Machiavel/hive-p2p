/**
 * Sandbox for testing WebSocket and transport connections.
 *
 * @typedef {import('./test-transports.mjs').TestWsConnection} TestWsConnection
 * @typedef {import('./test-transports.mjs').TestWsServer} TestWsServer
 * @typedef {import('./test-transports.mjs').TestTransport} TestTransport
 */
/**
 * @typedef {Object} SignalData
 * @property {string} transportId
 * @property {number} expiration
 * @property {'offer' | 'answer'} type
 * @property {Object} sdp
 * @property {string} sdp.id
 */
export class ICECandidateEmitter {
    /** @param {Sandbox} sandbox */
    constructor(sandbox: Sandbox);
    sandbox: Sandbox;
    SIGNAL_OFFER_TIMEOUT: number;
    SIGNAL_ANSWER_TIMEOUT: number;
    /** @type {Record<string, Record<string, SignalData>>} */ PENDING_OFFERS: Record<string, Record<string, SignalData>>;
    /** @type {Record<string, SignalData>} */ PENDING_ANSWERS: Record<string, SignalData>;
    /** @type {Array<{ transportId: string, type: 'offer' | 'answer', time: number }>} */ sdpToBuild: Array<{
        transportId: string;
        type: "offer" | "answer";
        time: number;
    }>;
    /** @type {Array<{ signalData: SignalData, receiverId: string }>} */ signalsToDigest: Array<{
        signalData: SignalData;
        receiverId: string;
    }>;
    tick(): void;
    /** @param {string} transportId @param {'offer' | 'answer'} type */
    buildSDP(transportId: string, type: "offer" | "answer"): void;
    /** @param {SignalData} signalData @param {string} receiverId */
    digestSignal(signalData: SignalData, receiverId: string): void;
    #private;
}
export class Sandbox {
    verbose: number;
    wsGlobalIndex: number;
    tGlobalIndex: number;
    /** @type {Record<string, TestTransport>} */ transportInstances: Record<string, TestTransport>;
    /** @type {Record<string, TestWsConnection>} */ wsConnections: Record<string, TestWsConnection>;
    /** @type {Record<string, TestWsServer>} */ publicWsServers: Record<string, TestWsServer>;
    inscribeWebSocketServer(url: any, testWsServer: any): void;
    removeWebSocketServer(url: any): void;
    inscribeWsConnection(testWsConnection: any): void;
    connectToWebSocketServer(url: any, clientWsConnectionId: any, instancier: any): void;
    inscribeInstance(transportInstance: any): void;
    linkInstances(offererId: any, answererId: any): string;
    sendData(fromId: any, toId: any, data: any): {
        success: boolean;
        reason: string;
    };
    destroyTransportAndAssociatedTransport(id: any): void;
    batchSize: number;
    messageQueueSync: any[];
    queueIndex: number;
    messageQueue: any[];
    queueStart: number;
    queueEnd: number;
    queueCount: number;
    processMessageQueueSync(): void;
    processMessageQueue(): Promise<void>;
    enqueueTransportDataSync(id: any, remoteId: any, data: any): void;
    enqueueWsMessageSync(id: any, remoteWsId: any, message: any): void;
    enqueueTransportData(id: any, remoteId: any, data: any): void;
    enqueueWsMessage(id: any, remoteWsId: any, message: any): void;
    #private;
}
/**
 * Sandbox for testing WebSocket and transport connections.
 */
export type TestWsConnection = import("./test-transports.mjs").TestWsConnection;
/**
 * Sandbox for testing WebSocket and transport connections.
 */
export type TestWsServer = import("./test-transports.mjs").TestWsServer;
/**
 * Sandbox for testing WebSocket and transport connections.
 */
export type TestTransport = import("./test-transports.mjs").TestTransport;
export type SignalData = {
    transportId: string;
    expiration: number;
    type: "offer" | "answer";
    sdp: {
        id: string;
    };
};

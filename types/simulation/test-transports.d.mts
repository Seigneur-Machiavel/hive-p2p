export class TestWsConnection {
    constructor(url: string, oppositeWsConnectionId: any);
    id: any;
    isTestTransport: boolean;
    remoteWsId: any;
    remoteId: boolean;
    delayBeforeConnectionTry: number;
    readyState: number;
    url: string;
    callbacks: {
        message: any[];
        close: any[];
        error: any[];
    };
    onmessage: any;
    onopen: any;
    onclose: any;
    onerror: any;
    init(remoteWsId: any): void;
    on(event: any, callback: any): void;
    close(): void;
    send(message: any): void;
    dispatchError(error: any): void;
}
export class TestWsServer {
    constructor(opts?: {
        port: any;
        host: any;
    });
    url: string;
    clients: Set<any>;
    maxClients: number;
    callbacks: {
        connection: any[];
        close: any[];
        error: any[];
    };
    on(event: any, callback: any): void;
    close(): void;
    closing: boolean;
}
export class TestTransport {
    /** @param {TestTransportOptions} opts */
    constructor(opts?: TestTransportOptions);
    destroying: any;
    destroyed: any;
    id: any;
    isTestTransport: boolean;
    remoteId: any;
    remoteWsId: boolean;
    callbacks: {
        connect: any[];
        close: any[];
        data: any[];
        signal: any[];
        error: any[];
    };
    initiator: boolean;
    trickle: boolean;
    wrtc: any;
    on(event: any, callbacks: any): void;
    dispatchError(message: any): void;
    signal(remoteSDP: any): void;
    /** @param {string | Uint8Array | Object} message */
    send(message: string | Uint8Array | any): void;
    close(): void;
    destroy(errorMsg?: any): void;
}
export const SANDBOX: Sandbox;
export const ICE_CANDIDATE_EMITTER: ICECandidateEmitter;
export const TEST_WS_EVENT_MANAGER: TestWsEventManager;
declare class TestTransportOptions {
    /** @type {boolean} */
    initiator: boolean;
    /** @type {boolean} */
    trickle: boolean;
    /** @type {any} */
    wrtc: any;
}
import { Sandbox } from './tranports-sandbox.mjs';
import { ICECandidateEmitter } from './tranports-sandbox.mjs';
declare class TestWsEventManager {
    /** @type {Array<{ connId: string, clientWsId: string, time: number }> } */ toInit: Array<{
        connId: string;
        clientWsId: string;
        time: number;
    }>;
    /** @type {Array<{ remoteWsId: string, time: number }> } */ toClose: Array<{
        remoteWsId: string;
        time: number;
    }>;
    /** @type {Array<{ wsId: string, error: Error, time: number }> } */ toError: Array<{
        wsId: string;
        error: Error;
        time: number;
    }>;
    initTick(): void;
    closeTick(): void;
    cleanerTick(): void;
    errorTick(): void;
    scheduleInit(connId: any, delay?: number): void;
    scheduleClose(wsId: any, remoteWsId: any, delay?: number): void;
    scheduleError(wsId: any, error: any, delay?: number): void;
    #private;
}
export {};

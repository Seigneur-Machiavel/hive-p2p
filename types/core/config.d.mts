export namespace SIMULATION {
    let AVOID_INTERVALS: boolean;
    let USE_TEST_TRANSPORTS: boolean;
    namespace ICE_DELAY {
        let min: number;
        let max: number;
    }
    let ICE_OFFER_FAILURE_RATE: number;
    let ICE_ANSWER_FAILURE_RATE: number;
    let AVOID_FOLLOWERS_NODES: boolean;
    let AUTO_START: boolean;
    let PUBLIC_PEERS_COUNT: number;
    let PEERS_COUNT: number;
    let BOOTSTRAPS_PER_PEER: number;
    let DELAY_BETWEEN_INIT: number;
    let RANDOM_UNICAST_PER_SEC: number;
    let RANDOM_GOSSIP_PER_SEC: number;
    let DIFFUSION_TEST_DELAY: number;
}
export namespace NODE {
    let DEFAULT_VERBOSE: number;
    let CONNECTION_UPGRADE_TIMEOUT: number;
    let IS_BROWSER: boolean;
}
export namespace SERVICE {
    let PORT: number;
    let AUTO_KICK_DELAY: number;
    let AUTO_KICK_DURATION: number;
    let MAX_WS_IN_CONNS: number;
}
export namespace IDENTITY {
    let DIFFICULTY: number;
    let ARGON2_MEM: number;
    let ARE_IDS_HEX: boolean;
    let PUBLIC_PREFIX: string;
    let STANDARD_PREFIX: string;
    let ID_LENGTH: number;
    let PUBKEY_LENGTH: number;
    let PRIVATEKEY_LENGTH: number;
    let SIGNATURE_LENGTH: number;
}
export namespace TRANSPORTS {
    let CENTRALIZED_STUN_SERVERS: boolean;
    let MAX_SDP_OFFERS: number;
    let ICE_COMPLETE_TIMEOUT: number;
    let SIGNAL_CREATION_TIMEOUT: number;
    let SDP_OFFER_EXPIRATION: number;
    let WS_CLIENT: {
        new (url: string | URL, protocols?: string | string[]): WebSocket;
        prototype: WebSocket;
        readonly CONNECTING: 0;
        readonly OPEN: 1;
        readonly CLOSING: 2;
        readonly CLOSED: 3;
    };
    let WS_SERVER: any;
    let PEER: any;
}
export namespace DISCOVERY {
    let PEER_LINK_DELAY: number;
    let PEER_LINK_EXPIRATION: number;
    let LOOP_DELAY: number;
    let TARGET_NEIGHBORS_COUNT: number;
    namespace ON_CONNECT_DISPATCH {
        let DELAY: number;
        let BROADCAST_EVENT: boolean;
        let OVER_NEIGHBORED: boolean;
        let SHARE_HISTORY: boolean;
    }
    namespace ON_DISCONNECT_DISPATCH {
        let DELAY_1: number;
        export { DELAY_1 as DELAY };
        let BROADCAST_EVENT_1: boolean;
        export { BROADCAST_EVENT_1 as BROADCAST_EVENT };
    }
    namespace ON_UNICAST {
        let DIGEST_TRAVELED_ROUTE: boolean;
    }
}
export namespace UNICAST {
    let MAX_HOPS: number;
    let MAX_NODES: number;
    let MAX_ROUTES: number;
    let MARKERS_BYTES: {
        message: number;
        '0': string;
        handshake: number;
        '1': string;
        signal_answer: number;
        '2': string;
        signal_offer: number;
        '3': string;
    };
}
export namespace GOSSIP {
    export let EXPIRATION: number;
    export let CACHE_DURATION: number;
    export namespace HOPS {
        let _default: number;
        export { _default as default };
        export let signal_offer: number;
        export let diffusion_test: number;
        export let over_neighbored: number;
    }
    export namespace TRANSMISSION_RATE {
        export let MIN_NEIGHBOURS_TO_APPLY_PONDERATION: number;
        export let NEIGHBOURS_PONDERATION: number;
        export let Default: number;
        let signal_offer_1: number;
        export { signal_offer_1 as signal_offer };
    }
    let MARKERS_BYTES_1: {
        gossip: number;
        '128': string;
        signal_offer: number;
        '129': string;
        peer_connected: number;
        '130': string;
        peer_disconnected: number;
        '131': string;
        diffusion_test: number;
        '132': string;
        over_neighbored: number;
        '133': string;
    };
    export { MARKERS_BYTES_1 as MARKERS_BYTES };
}
export namespace LOG_CSS {
    let SIMULATOR: string;
    let ARBITER: string;
    let CRYPTO_CODEX: string;
    let GOSSIP: string;
    let UNICAST: string;
    let PEER_STORE: string;
    let SERVICE: string;
    namespace PUNISHER {
        let BAN: string;
        let KICK: string;
    }
}
declare namespace _default {
    export { SIMULATION };
    export { NODE };
    export { TRANSPORTS };
    export { DISCOVERY };
    export { IDENTITY };
    export { UNICAST };
    export { GOSSIP };
    export { LOG_CSS };
}
export default _default;

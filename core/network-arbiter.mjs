import { CLOCK, SIMULATION, NODE } from './parameters.mjs';
const { SANDBOX, ICE_CANDIDATE_EMITTER, TEST_WS_EVENT_MANAGER } = SIMULATION.ENABLED ? await import('../simulation/test-transports.mjs') : {};

class ReputationEntry {
	score;
	lastActivity;
	infractions;
	positiveActions;
	
	/** @param {number} initialScore */
	constructor(initialScore = Reputation.DEFAULT_SCORE) {
		this.score = initialScore;
		this.lastActivity = CLOCK.time;
		this.infractions = [];
		this.positiveActions = [];
	}

	/** @param {string} action @param {number} points @param {Object} context */
	recordAction(action, points, context = {}) {
		// Enregistrer une action dans l'historique
	}

	/** @returns {number} */
	getRecentPositiveScore() {
		// Calculer le score des actions positives récentes
		// Utilisé pour déterminer l'absorption d'infractions
	}
}

export class Reputation {
	/** @type {Record<string, ReputationEntry>} */ peerReputation = {};
	/** @type {Record<string, number>} */ globalBans = {}; // ID fraud bans to broadcast
	
	// Constants - tu peux les externaliser dans parameters.mjs
	static MAX_SCORE = 1000;
	static DEFAULT_SCORE = 100;
	static ABSORPTION_THRESHOLD = 50; // crédits nécessaires pour absorber une infraction
	
	// Actions positives (gains lents et mesurés)
	static REWARDS = {
		MESSAGE_RELAY: 1,           // relayer un message gossip valide
		ROUTE_SUCCESS: 2,           // route unicast qui aboutit
		VALID_SIGNATURE: 0.5,       // signature vérifiée correcte
		NETWORK_DISCOVERY: 3,       // apporter une nouvelle route/connection
		UPTIME_CONSISTENCY: 1       // maintenir connections stables
	};
	
	// Actions négatives (chutes rapides et sévères)
	static PENALTIES = {
		SPAM_GOSSIP: -20,           // flood de messages gossip
		INVALID_SIGNATURE: -50,     // signature frauduleuse
		ROUTE_POLLUTION: -30,       // routes bidons pour polluer
		EXCESSIVE_RECONNECT: -10,   // reconnections abusives
		PROTOCOL_VIOLATION: -40     // non-respect du protocole
	};
	
	// Infractions critiques (ban instant)
	static CRITICAL_VIOLATIONS = {
		ID_FRAUD: 'id_fraud',               // usurper un ID existant
		POW_BYPASS_ATTEMPT: 'pow_bypass',   // essayer de contourner la POW
		SIGNATURE_FORGERY: 'sig_forgery'    // falsifier la signature d'un autre
	};

	constructor(verbose = 0) {
		this.verbose = verbose;
	}

	// === REPUTATION MANAGEMENT ===
	/** @param {string} peerId */
	#ensurePeerEntry(peerId) {
		// Créer une entrée si elle n'existe pas
	}

	/** @param {string} peerId @param {number} points @param {string} reason */
	addReputation(peerId, points, reason) {
		// Ajouter des points de réputation (avec cap au max)
		// Logger l'action si verbose
	}

	/** @param {string} peerId @param {number} points @param {string} reason */
	removeReputation(peerId, points, reason) {
		// Retirer des points (peut aller en négatif)
		// Logger l'action si verbose
	}

	/** @param {string} peerId @returns {number} */
	getScore(peerId) {
		// Retourner le score actuel du peer
	}

	/** @param {string} peerId @returns {boolean} */
	canAbsorbInfraction(peerId) {
		// Vérifier si le peer a assez de crédits pour absorber une infraction
	}

	/** @param {string} peerId @param {number} points @returns {boolean} */
	tryAbsorbInfraction(peerId, points) {
		// Tenter d'absorber une infraction avec les crédits disponibles
		// Retourner true si absorbée, false si pas assez de crédits
	}

	// === CRITICAL VIOLATIONS ===
	/** @param {string} peerId @param {string} violationType @param {Object} evidence */
	flagCriticalViolation(peerId, violationType, evidence) {
		// Ban instant + préparation pour diffusion réseau
		// Logger avec détails de l'évidence
	}

	/** @returns {Array<{peerId: string, violation: string, timestamp: number}>} */
	getPendingGlobalBans() {
		// Retourner les bans à diffuser au réseau
	}

	/** @param {string} peerId */
	markGlobalBanBroadcast(peerId) {
		// Marquer un ban comme diffusé (pour éviter re-diffusion)
	}

	// === ACTION HANDLERS ===
	/** @param {string} peerId @param {string} action @param {Object} context */
	recordPositiveAction(peerId, action, context = {}) {
		// Enregistrer une action positive et ajuster la réputation
	}

	/** @param {string} peerId @param {string} violation @param {Object} context */
	recordViolation(peerId, violation, context = {}) {
		// Enregistrer une violation et appliquer la pénalité
		// Vérifier si c'est critique ou si ça peut être absorbé
	}

	// === VALIDATION HELPERS ===
	/** @param {string} peerId @param {Uint8Array} signature @param {Uint8Array} data @returns {boolean} */
	validateMessageSignature(peerId, signature, data) {
		// Valider une signature de message
		// Enregistrer le résultat (positif ou négatif)
	}

	/** @param {string} peerId @param {string} claimedId @returns {boolean} */
	validatePeerIdentity(peerId, claimedId) {
		// Vérifier que le peer n'usurpe pas un autre ID
		// Flag critique si fraude détectée
	}

	// === CLEANUP ===
	cleanupExpiredEntries() {
		// Nettoyer les anciennes entrées si nécessaire
		// Peut-être appliquer une dégradation naturelle du score dans le temps ?
	}
}

export class Arbiter {
	id; cryptoCodex; verbose;
	/** @type {Record<string, number>} */ ban = {};
	

	/** @param {string} selfId @param {CryptoCodex} cryptoCodex @param {number} verbose */
	constructor(selfId, cryptoCodex, verbose = 0) {
		this.id = selfId; this.cryptoCodex = cryptoCodex; this.verbose = verbose;
	}

	/** @param {string} peerId @param {'ban'} [type] default: kick @param {number} [duration] default: 60_000 */
	sanctionPeer(peerId, type = 'kick', duration = 60_000) {
		// TODO
	}
	/** @param {string} peerId @param {'kick' | 'ban'} [type] default: kick */
	isSanctioned(peerId, type = 'kick') {
		return false;
	}

	isBanned() { return false; }
}
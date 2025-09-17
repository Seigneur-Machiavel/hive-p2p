/**
 * Synchronized Network Clock
 * Simple, efficient NTP-based time synchronization
 */

export class Clock {
	verbose;
	mockMode; // if true, use local time without sync
	static #instance = null;

	#offset = null; // ms difference from local time
	#syncing = false;
	#lastSync = 0;
	#sources = ['time.google.com', 'time.cloudflare.com', 'pool.ntp.org'];

	constructor(verbose = 0, mockMode = false) {
		this.verbose = verbose;
		this.mockMode = mockMode;
		if (Clock.#instance) return Clock.#instance;
		else Clock.#instance = this;
	}
	
	// PUBLIC API
	static get instance() { return Clock.#instance || new Clock(); }
	static get time() { return Clock.instance.time; } // Sync API - returns current synchronized time or null
	get time() { 
		if (this.mockMode) return Date.now();
		if (this.#offset === null) return null; 
		return Date.now() + this.#offset; 
	}
	async sync(verbose) { // Force synchronization - returns promise with synchronized time
		if (verbose !== undefined) this.verbose = verbose;
		if (this.mockMode) return Date.now(); // Bypass sync in mock mode

		if (this.#syncing) { // Wait for current sync to complete
			while (this.#syncing) await new Promise(resolve => setTimeout(resolve, 50));
			return this.time;
		}

		this.#syncing = true;

		try {
			const samples = await this.#fetchTimeSamples();
			if (samples.length === 0) {
				console.warn('[Clock] All NTP sources failed, using local time');
				this.#offset = 0;
				return this.time;
			}

			this.#offset = this.#calculateOffset(samples);
			this.#lastSync = Date.now();

			// Continue refining in background if we got partial results
			if (samples.length < this.#sources.length) setTimeout(() => this.#backgroundRefine(), 100);
			return this.time;
		} catch (error) {
			console.error('[Clock] Sync failed:', error);
			this.#offset = 0; // Fallback to local time
			return this.time;
		} finally { this.#syncing = false; }
	}
	get status() { // Get sync status info
		if (this.mockMode) return { synchronized: true, syncing: false, offset: 0, lastSync: Date.now(), age: 0 };
		return {
			synchronized: this.#offset !== null,
			syncing: this.#syncing,
			offset: this.#offset,
			lastSync: this.#lastSync,
			age: this.#lastSync ? Date.now() - this.#lastSync : null
		};
	}

	// PRIVATE METHODS
	async #fetchTimeSamples() { // Fetch time samples from all sources in parallel
		const promises = this.#sources.map(source => this.#fetchTimeFromSource(source));
		const results = await Promise.allSettled(promises);
		const samples = [];
		for (const result of results) if (result.status === 'fulfilled') samples.push(result.value);
		return samples;
	}
	/** @param {'time.google.com' | 'time.cloudflare.com' | 'pool.ntp.org'} source */
	async #fetchTimeFromSource(source) { // Fetch time from a single NTP source
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout

		try {
			const startTime = Date.now();
			const response = await fetch(`https://${source}`, { method: 'HEAD', signal: controller.signal, cache: 'no-cache' });
			const networkLatency = (Date.now() - startTime) / 2; // Rough RTT/2
			if (!response.ok) throw new Error(`HTTP ${response.status}`);

			const serverTime = new Date(response.headers.get('date')).getTime();
			if (isNaN(serverTime)) throw new Error('Invalid date header');

			return {
				source,
				serverTime: serverTime + networkLatency, // Compensate for network delay
				localTime: Date.now(),
				latency: networkLatency * 2
			};
		} finally { clearTimeout(timeoutId); }
	}
	/** @param {Array<{serverTime: number, localTime: number, latency: number}>} samples */
	#calculateOffset(samples) { // Calculate offset from multiple samples
		if (samples.length === 1) return samples[0].serverTime - samples[0].localTime;
		samples.sort((a, b) => a.latency - b.latency); // Sort by latency, prefer lower latency sources

		const offsets = [];
		for (const sample of samples) offsets.push(sample.serverTime - sample.localTime);
		offsets.sort((a, b) => a - b); // Use median to filter outliers
		const mid = Math.floor(offsets.length / 2);

		if (offsets.length % 2 === 0) return (offsets[mid - 1] + offsets[mid]) / 2;
		return offsets[mid];
	}
	async #backgroundRefine() { // Background refinement after initial sync
		if (this.#syncing) return;

		try {
			const samples = await this.#fetchTimeSamples();
			if (samples.length === 0) return; // All failed
			
			// Only update if change is significant (> 100ms)
			const newOffset = this.#calculateOffset(samples);
			if (Math.abs(newOffset - this.#offset) > 100) this.#offset = newOffset;
		} catch (error) { if (this.verbose) console.warn('[Clock] Background refine failed:', error); }
	}
}


async function TEST() { // DEBUG TEST WHILE RUNNING AS STANDALONE
	const startTime = Date.now();
	const clock = new Clock();
	clock.sync().then(() => {
		console.log('Synchronized in: ', Date.now() - startTime, 'ms');
		console.log('Synchronized time:', new Date(clock.time).toISOString());
		console.log('Clock status:', clock.status);
	}).catch(console.error);
	
	while (true) {
		console.log('Clock status:', clock.status);
		await new Promise(r => setTimeout(r, 1000));
	}
}
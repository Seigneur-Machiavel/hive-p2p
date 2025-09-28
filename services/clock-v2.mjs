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
	#browserSources = [
		'worldtimeapi.org/api/timezone/UTC',
		'timeapi.io/api/Time/current/zone?timeZone=UTC', 
		'api.github.com'
	];

	constructor(verbose = 0, mockMode = false) {
		this.verbose = verbose;
		this.mockMode = mockMode;
		if (Clock.#instance) return Clock.#instance;
		else Clock.#instance = this;
	}
	
	// PUBLIC API
	static get instance() { return Clock.#instance || new Clock(); }
	static get time() { return Clock.instance.time; }
	get time() { 
		if (this.mockMode) return Date.now();
		if (this.#offset === null) return null; 
		return Date.now() + Math.round(this.#offset); 
	}

	async sync(verbose) {
		if (verbose !== undefined) this.verbose = verbose;
		if (this.mockMode) return Date.now();

		if (this.#syncing) {
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

			if (samples.length < this.#sources.length) 
				setTimeout(() => this.#backgroundRefine(), 100);
			return this.time;
		} catch (error) {
			console.error('[Clock] Sync failed:', error);
			this.#offset = 0;
			return this.time;
		} finally { 
			this.#syncing = false; 
		}
	}

	get status() {
		if (this.mockMode) return { 
			synchronized: true, syncing: false, offset: 0, 
			lastSync: Date.now(), age: 0 
		};
		return {
			synchronized: this.#offset !== null,
			syncing: this.#syncing,
			offset: this.#offset,
			lastSync: this.#lastSync,
			age: this.#lastSync ? Date.now() - this.#lastSync : null
		};
	}

	// PRIVATE METHODS
	async #fetchTimeSamples() {
		const sources = (typeof window !== 'undefined') ? this.#browserSources : this.#sources;
		const promises = sources.map(source => this.#fetchTimeFromSource(source));
		const results = await Promise.allSettled(promises);
		
		const samples = [];
		for (const result of results) {
			if (result.status === 'fulfilled' && result.value) {
				samples.push(result.value);
			}
		}
		return samples;
	}

	async #fetchTimeFromSource(source) {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 5000); // Plus de timeout

		try {
			const startTime = Date.now();
			const url = source.startsWith('http') ? source : `https://${source}`;
			
			const response = await fetch(url, { 
				method: source.includes('api.github.com') ? 'HEAD' : 'GET',
				signal: controller.signal, 
				cache: 'no-cache',
				mode: 'cors' // Explicit CORS
			});
			
			const networkLatency = (Date.now() - startTime) / 2;
			if (!response.ok) throw new Error(`HTTP ${response.status}`);

			let serverTime;
			
			if (source.includes('worldtimeapi')) {
				const data = await response.json();
				serverTime = new Date(data.utc_datetime).getTime();
			} else if (source.includes('timeapi')) {
				const data = await response.json();
				serverTime = new Date(data.dateTime).getTime();
			} else {
				const dateHeader = response.headers.get('date');
				if (!dateHeader) throw new Error('No date header');
				serverTime = new Date(dateHeader).getTime();
			}

			if (isNaN(serverTime)) throw new Error('Invalid time data');

			return {
				source,
				serverTime: serverTime + networkLatency,
				localTime: Date.now(),
				latency: networkLatency * 2
			};
		} catch (error) {
			if (this.verbose) console.warn(`[Clock] Failed to fetch time from ${source}:`, error.message);
			return null; // Retourne explicitement null au lieu d'undefined
		} finally { 
			clearTimeout(timeoutId); 
		}
	}

	#calculateOffset(samples) {
		// Filter out null samples (au cas où)
		const validSamples = samples.filter(sample => sample !== null);
		if (validSamples.length === 0) return 0;
		if (validSamples.length === 1) return validSamples[0].serverTime - validSamples[0].localTime;
		
		validSamples.sort((a, b) => a.latency - b.latency);

		const offsets = [];
		for (const sample of validSamples) 
			offsets.push(sample.serverTime - sample.localTime);
		
		offsets.sort((a, b) => a - b);
		const mid = Math.floor(offsets.length / 2);

		if (offsets.length % 2 === 0) 
			return (offsets[mid - 1] + offsets[mid]) / 2;
		return offsets[mid];
	}

	async #backgroundRefine() {
		if (this.#syncing) return;

		try {
			const samples = await this.#fetchTimeSamples();
			if (samples.length === 0) return;
			
			const newOffset = this.#calculateOffset(samples);
			if (Math.abs(newOffset - this.#offset) > 100) 
				this.#offset = newOffset;
		} catch (error) { 
			if (this.verbose) console.warn('[Clock] Background refine failed:', error); 
		}
	}
}

export async function CLOCK_TEST() {
	const startTime = Date.now();
	const clock = new Clock(1); // Verbose pour debug
	
	try {
		await clock.sync();
		console.log('Synchronized in:', Date.now() - startTime, 'ms');
		console.log('Synchronized time:', new Date(clock.time).toISOString());
		console.log('Clock status:', clock.status);
	} catch (error) {
		console.error('Sync failed:', error);
	}
}
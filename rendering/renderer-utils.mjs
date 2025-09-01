
export class FpsStabilizer {
	fpsCountElement;
	targetMaxFPS;

	lastFrameTime = null;
	nextFrameTime = null;
	frameTimes = [];
	frameCount = 0;
	FPS;

	/** @param {HTMLElement} fpsCountElement */
	constructor(fpsCountElement, targetMaxFPS = 60) {
		this.fpsCountElement = fpsCountElement;
		this.targetMaxFPS = targetMaxFPS;
		this.FPS = targetMaxFPS;
	}

	scheduleNextFrameStrict(currentTime) {
		const targetFrameTime = 1000 / this.targetMaxFPS;
		if (!this.nextFrameTime) this.nextFrameTime = currentTime + targetFrameTime;
		while (this.nextFrameTime <= currentTime) this.nextFrameTime += targetFrameTime;
		return this.nextFrameTime - currentTime;
	}
	updateFPS(currentTime) {
		this.frameCount++;
		if (!this.frameTimes) { this.frameTimes = []; this.lastFrameTime = currentTime; }
		
		const deltaTime = currentTime - this.lastFrameTime;
		this.lastFrameTime = currentTime;
		this.frameTimes.push(deltaTime);
		if (this.frameTimes.length > 30) this.frameTimes.shift();

		const avgDelta = this.frameTimes.reduce((sum, dt) => sum + dt, 0) / this.frameTimes.length;
		this.FPS = Math.round(1000 / avgDelta);
		if (this.frameCount % 30 === 0) this.fpsCountElement.textContent = this.FPS;
	}
	reset() {
		this.frameTimes = [];
		this.lastFrameTime = null;
		this.nextFrameTime = null;
		this.frameCount = 0;
	}
}
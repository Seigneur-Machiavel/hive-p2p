export class FpsStabilizer {
	fpsCountElement;
	targetMaxFPS;
	targetFrameTime;

	lastFrameTime = 0;
	frameTimes = [];
	frameCount = 0;
	FPS = 60;
	
	// Stabilisation
	accumulator = 0;
	maxDelta = 50; // Évite les gros pics

	constructor(fpsCountElement, targetMaxFPS = 120) {
		this.fpsCountElement = fpsCountElement;
		this.targetMaxFPS = targetMaxFPS;
		this.targetFrameTime = 1000 / targetMaxFPS;
	}

	shouldRender(currentTime) {
		if (this.lastFrameTime === 0) {
			this.lastFrameTime = currentTime;
			return true;
		}

		const deltaTime = Math.min(currentTime - this.lastFrameTime, this.maxDelta);
		this.accumulator += deltaTime;

		if (this.accumulator >= this.targetFrameTime) {
			this.accumulator -= this.targetFrameTime;
			this.lastFrameTime = currentTime;
			return true;
		}

		return false;
	}

	updateFPS(currentTime) {
		this.frameCount++;
		
		const deltaTime = currentTime - this.lastFrameTime;
		this.frameTimes.push(deltaTime);
		if (this.frameTimes.length > 30) this.frameTimes.shift();

		const avgDelta = this.frameTimes.reduce((sum, dt) => sum + dt, 0) / this.frameTimes.length;
		this.FPS = Math.round(1000 / avgDelta);
		
		if (this.frameCount % 30 === 0) this.fpsCountElement.textContent = this.FPS;
	}

	reset() {
		this.frameTimes = [];
		this.lastFrameTime = 0;
		this.frameCount = 0;
		this.accumulator = 0;
	}
}
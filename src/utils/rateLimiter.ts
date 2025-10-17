export class TokenBucket {
  private capacity: number;
  private tokens: number;
  private refillPerSec: number;
  private lastRefill: number;

  constructor(capacity = 3, refillPerSec = 3) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerSec = refillPerSec;
    this.lastRefill = Date.now();
  }
  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    const add = elapsed * this.refillPerSec;
    this.tokens = Math.min(this.capacity, this.tokens + add);
    this.lastRefill = now;
  }
  async take(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await new Promise(r => setTimeout(r, 50));
    }
  }
}

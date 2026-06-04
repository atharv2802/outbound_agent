/**
 * Token-bucket rate limiter. Blocks (awaits) until a slot is available rather
 * than dropping requests, so bursty fan-out fetching stays under OpenAI / Jina
 * limits without losing work.
 */

export class TokenBucket {
  private tokens: number;
  private readonly refillPerMs: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    refillPerMin: number,
  ) {
    this.tokens = capacity;
    this.refillPerMs = refillPerMin / 60_000;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    // Loop because multiple waiters may wake at once.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const needed = 1 - this.tokens;
      const waitMs = Math.ceil(needed / this.refillPerMs);
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 1000)));
    }
  }
}

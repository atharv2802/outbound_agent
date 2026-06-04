/**
 * Three-state circuit breaker (CLOSED → OPEN → HALF_OPEN). Opens after N
 * consecutive failures to a service, rejects fast while open, then probes with
 * a limited number of test requests before closing again.
 */

import { config } from "@/lib/config";

export type CircuitState = "closed" | "open" | "half_open";

export class CircuitOpenError extends Error {
  constructor(service: string) {
    super(`Circuit breaker open for "${service}" — service temporarily unavailable.`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenInFlight = 0;
  private halfOpenSuccesses = 0;

  constructor(private service: string) {}

  get currentState(): CircuitState {
    this.maybeHalfOpen();
    return this.state;
  }

  private maybeHalfOpen(): void {
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= config.gateway.circuitBreaker.openMs) {
        this.state = "half_open";
        this.halfOpenInFlight = 0;
        this.halfOpenSuccesses = 0;
      }
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeHalfOpen();

    if (this.state === "open") {
      throw new CircuitOpenError(this.service);
    }

    if (this.state === "half_open") {
      if (this.halfOpenInFlight >= config.gateway.circuitBreaker.halfOpenMax) {
        throw new CircuitOpenError(this.service);
      }
      this.halfOpenInFlight += 1;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === "half_open") {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= config.gateway.circuitBreaker.halfOpenMax) {
        this.reset();
      }
    } else {
      this.consecutiveFailures = 0;
    }
  }

  private onFailure(): void {
    if (this.state === "half_open") {
      this.trip();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= config.gateway.circuitBreaker.failureThreshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.state = "open";
    this.openedAt = Date.now();
  }

  private reset(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.halfOpenInFlight = 0;
    this.halfOpenSuccesses = 0;
  }
}

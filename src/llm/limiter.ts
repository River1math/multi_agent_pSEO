/** Caps how many operations run at once; excess callers queue in FIFO order. */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (limit < 1) throw new Error("concurrency limit must be at least 1");
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await operation();
    } finally {
      const next = this.waiting.shift();
      // Hand the slot straight to the next waiter, so `active` never dips and nobody jumps the queue.
      if (next) next();
      else this.active--;
    }
  }
}

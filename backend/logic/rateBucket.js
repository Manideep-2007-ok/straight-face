// Token bucket: `capacity` burst, refilled at `perSec` tokens per second.
export class RateBucket {
  constructor(capacity, perSec, now = () => Date.now()) {
    this.capacity = capacity;
    this.perSec = perSec;
    this.now = now;
    this.tokens = capacity;
    this.last = now();
  }

  take(cost = 1) {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSec);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

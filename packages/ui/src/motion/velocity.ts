/** Timestamps are performance.now()-style milliseconds. Fixed ring buffer; push allocates nothing. */
export class VelocityTracker {
  private xs = new Float64Array(128)
  private ys = new Float64Array(128)
  private ts = new Float64Array(128)
  private start = 0
  private count = 0

  push(x: number, y: number, t: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) return

    if (this.count && t < this.ts[(this.start + this.count - 1) % 128]!) this.reset()

    while (this.count > 0 && t - this.ts[this.start]! > 90) {
      this.start = (this.start + 1) % 128
      this.count--
    }

    if (this.count === 128) {
      this.start = (this.start + 1) % 128
      this.count--
    }

    const index = (this.start + this.count++) % 128
    this.xs[index] = x
    this.ys[index] = y
    this.ts[index] = t
  }

  velocity() {
    if (this.count < 2) return { x: 0, y: 0 }
    const last = (this.start + this.count - 1) % 128
    const seconds = (this.ts[last]! - this.ts[this.start]!) / 1000

    if (seconds <= 0 || performance.now() - this.ts[last]! > 90) return { x: 0, y: 0 }

    return {
      x: (this.xs[last]! - this.xs[this.start]!) / seconds,
      y: (this.ys[last]! - this.ys[this.start]!) / seconds,
    }
  }

  reset(): void {
    this.start = this.count = 0
  }
}

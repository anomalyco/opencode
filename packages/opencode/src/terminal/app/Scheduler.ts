export class Scheduler {
  private frameScheduled = false
  private dirty = false
  private paused = false
  private renderCallback: (() => boolean | void) | null = null
  private running = false

  private tickCallbacks: (() => void)[] = []
  private tickInterval: ReturnType<typeof setInterval> | null = null
  private tickActive = false

  get isPaused(): boolean {
    return this.paused
  }

  onRender(callback: () => boolean | void): void {
    this.renderCallback = callback
  }

  requestFrame(): void {
    if (!this.running) return
    this.dirty = true
    this.schedule()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.paused = false
    this.dirty = false
    process.stdout.on("drain", this.onDrain)
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.frameScheduled = false
    this.dirty = false
    this.stopTick()
    process.stdout.off("drain", this.onDrain)
  }

  onTick(cb: () => void): () => void {
    this.tickCallbacks.push(cb)
    if (!this.tickActive) this.startTick()
    return () => {
      this.tickCallbacks = this.tickCallbacks.filter(c => c !== cb)
      if (this.tickCallbacks.length === 0) this.stopTick()
    }
  }

  private startTick(): void {
    if (this.tickActive) return
    this.tickActive = true
    this.tickInterval = setInterval(() => {
      for (const cb of this.tickCallbacks) cb()
    }, 100)
  }

  private stopTick(): void {
    if (!this.tickActive) return
    this.tickActive = false
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval)
      this.tickInterval = null
    }
  }

  private schedule(): void {
    if (this.frameScheduled || this.paused) return
    this.frameScheduled = true
    setImmediate(() => this.tick())
  }

  private tick(): void {
    this.frameScheduled = false
    if (!this.running || this.paused) return
    if (!this.dirty) return

    this.dirty = false
    const result = this.renderCallback?.()
    if (result === false) {
      this.paused = true
    }
  }

  private onDrain = (): void => {
    this.paused = false
    if (this.dirty) this.schedule()
  }
}

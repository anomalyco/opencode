export class OutputChannel {
  private sink: (output: string) => boolean | void
  private queue: string[] = []
  private draining = false
  private drainCallbacks: (() => void)[] = []

  constructor(sink?: (output: string) => boolean | void) {
    this.sink = sink ?? ((out: string) => process.stdout.write(out))
  }

  start(): void {
    process.stdout.on("drain", this.handleDrain)
  }

  stop(): void {
    process.stdout.off("drain", this.handleDrain)
  }

  write(output: string): boolean {
    if (this.draining) {
      this.queue.push(output)
      return false
    }

    const result = this.sink(output)
    if (result === false) {
      this.queue.push(output)
      this.draining = true
      return false
    }

    return true
  }

  onDrain(cb: () => void): void {
    this.drainCallbacks.push(cb)
  }

  private handleDrain = (): void => {
    this.draining = false
    for (const cb of this.drainCallbacks) cb()
    this.flush()
  }

  private flush(): void {
    while (this.queue.length > 0 && !this.draining) {
      const chunk = this.queue.shift()!
      if (this.sink(chunk) === false) {
        this.queue.unshift(chunk)
        this.draining = true
        return
      }
    }
  }

  get isDraining(): boolean {
    return this.draining
  }

  get queueLength(): number {
    return this.queue.length
  }
}

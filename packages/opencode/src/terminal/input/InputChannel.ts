import { InputHandler, type InputEvent } from "./InputHandler"

export class InputChannel {
  private handler = new InputHandler()
  private callbacks: Set<(event: InputEvent) => void> = new Set()
  private buffer: InputEvent[] = []
  private paused = false

  constructor() {
    this.handler.on((event) => {
      if (this.paused) {
        this.buffer.push(event)
        return
      }
      for (const cb of this.callbacks) cb(event)
    })
  }

  onEvent(cb: (event: InputEvent) => void): () => void {
    this.callbacks.add(cb)
    return () => { this.callbacks.delete(cb) }
  }

  start(): void {
    this.handler.attach()
  }

  stop(): void {
    this.handler.detach()
    this.buffer = []
  }

  feed(data: string): void {
    this.handler.feed(data)
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
    if (this.buffer.length > 0) {
      const pending = this.buffer
      this.buffer = []
      for (const evt of pending) {
        for (const cb of this.callbacks) cb(evt)
      }
    }
  }

  get isPaused(): boolean {
    return this.paused
  }
}

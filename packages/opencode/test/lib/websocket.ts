export class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = FakeWebSocket.CONNECTING
  closed = false
  sent: string[] = []
  listeners = new Map<string, Set<(event: { data?: unknown }) => void>>()

  constructor(
    readonly url: string,
    readonly options?: { headers?: Record<string, string> },
  ) {}

  addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    const current = this.listeners.get(type) ?? new Set<(event: { data?: unknown }) => void>()
    current.add(listener)
    this.listeners.set(type, current)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.closed = true
    this.readyState = FakeWebSocket.CLOSED
    this.emit("close", {})
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.emit("open", {})
  }

  message(data: unknown) {
    this.emit("message", { data })
  }

  emit(type: string, event: { data?: unknown }) {
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

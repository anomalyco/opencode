type EventHandler = (...args: any[]) => void

class BrowserSocketStub {
  private readonly handlers = new Map<string, Set<EventHandler>>()

  on(event: string, handler: EventHandler): this {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler)
    return this
  }

  once(event: string, handler: EventHandler): this {
    const wrapped: EventHandler = (...args) => {
      this.off(event, wrapped)
      handler(...args)
    }
    return this.on(event, wrapped)
  }

  off(event: string, handler: EventHandler): this {
    this.handlers.get(event)?.delete(handler)
    return this
  }

  emit(event: string, ...args: any[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args)
    }
  }

  destroy(): void {
    this.emit("close")
  }
}

export function createConnection(_port?: number, _host?: string): BrowserSocketStub {
  const socket = new BrowserSocketStub()
  queueMicrotask(() => {
    socket.emit("error", new Error("Network sockets are unavailable in browser mode"))
  })
  return socket
}

export function connect(port?: number, host?: string): BrowserSocketStub {
  return createConnection(port, host)
}

export default {
  createConnection,
  connect,
}

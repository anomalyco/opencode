export interface SSEEvent {
  type: string
  properties: Record<string, unknown>
}

export interface BrowserOpenEvent {
  type: "browser.open"
  properties: {
    url: string
    callbackPort?: number
  }
}

export function parseSSELines(buffer: string): { events: SSEEvent[]; remainder: string } {
  const lines = buffer.split("\n")
  const remainder = lines.pop() || ""
  const events: SSEEvent[] = []

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue
    const json = line.slice(6)
    try {
      events.push(JSON.parse(json) as SSEEvent)
    } catch {}
  }

  return { events, remainder }
}

export function isBrowserOpen(event: SSEEvent): event is BrowserOpenEvent {
  return event.type === "browser.open" && typeof (event.properties as Record<string, unknown>).url === "string"
}

export function createDeduplicator(windowMs = 5000) {
  const recent = new Map<string, number>()

  return {
    isDuplicate(url: string, now = Date.now()) {
      const last = recent.get(url)
      if (last && now - last < windowMs) return true
      recent.set(url, now)
      return false
    },
    clear() {
      recent.clear()
    },
  }
}

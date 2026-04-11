export type TTSTelemetryEvent = {
  timestamp: string
  event: string
  sessionID: string
  messageID: string
  partID?: string
  reason?: string
  duration?: number
  queueLength?: number
  error?: string
}

export function sendTTSEvent(url: () => string, fetcher: () => typeof fetch, evt: TTSTelemetryEvent): void {
  // Fire-and-forget: no await, no blocking
  const f = fetcher() ?? fetch
  f(`${url()}/tts/telemetry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(evt),
  }).catch(() => {
    // Telemetry failure must never break playback
  })
}

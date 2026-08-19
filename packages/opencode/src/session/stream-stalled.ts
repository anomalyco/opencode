// Raised by the LLM stream watchdog (llm.ts) when a provider stream delivers
// no events for the configured inactivity deadline — the half-open-socket
// case observed 2026-07-25, where a finished provider left the client reading
// a stream that would never deliver another byte for 18h48m.
//
// Own module so message-v2.ts (error mapping) can import it without touching
// llm.ts and its layer graph.

export class StreamStalledError extends Error {
  override readonly name = "StreamStalledError"
  constructor(readonly seconds: number) {
    super(`Provider stream stalled: no events for ${seconds}s; the connection was abandoned`)
  }

  static isInstance(e: unknown): e is StreamStalledError {
    return e instanceof Error && e.name === "StreamStalledError"
  }
}

export * as StreamStalled from "./stream-stalled"

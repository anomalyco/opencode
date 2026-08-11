// fork (skein-duey): transient channel for llama-skein model-load "loading theme"
// flavor text.
//
// While a local model loads, llama-skein streams themed flavor as
// reasoning_content deltas marked `skein_loading: true`. The provider stream
// wrapper (provider.ts: stripSkeinLoading) removes those deltas from the stream
// the ai-sdk/persistence sees — they must NEVER reach the session DB (they once
// grew it to ~16 GB) — and forwards their text here instead.
//
// This is deliberately a fire-and-forget in-process emitter: subscribers render
// the text live in a transient view; with no subscribers the text is simply
// dropped. That guarantees the persistence path can never receive it, by
// construction, regardless of whether a live display is wired up.
type Listener = (text: string) => void

const listeners = new Set<Listener>()

// Timestamp of the most recent stripped loading-flavor delta. The stream
// inactivity watchdog (llm.ts) reads this to tell "a model is loading right
// now" from "the stream is dead": loading chunks are removed before the
// ai-sdk, so from the event stream's perspective a long cold load is total
// silence — exactly what the watchdog is meant to kill.
let lastEmitAt = 0

export const SkeinLoading = {
  /** Called by the provider stream wrapper for each stripped loading-flavor delta. */
  emit(text: string): void {
    lastEmitAt = Date.now()
    for (const listener of listeners) {
      try {
        listener(text)
      } catch {
        // a broken display subscriber must never disrupt the model stream
      }
    }
  },
  /** True when a loading-flavor delta was observed within the last `ms`. */
  activeWithin(ms: number): boolean {
    return Date.now() - lastEmitAt < ms
  },
  /** Subscribe a transient display; returns an unsubscribe fn. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

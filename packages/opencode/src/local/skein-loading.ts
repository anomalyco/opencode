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

export const SkeinLoading = {
  /** Called by the provider stream wrapper for each stripped loading-flavor delta. */
  emit(text: string): void {
    for (const listener of listeners) {
      try {
        listener(text)
      } catch {
        // a broken display subscriber must never disrupt the model stream
      }
    }
  },
  /** Subscribe a transient display; returns an unsubscribe fn. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

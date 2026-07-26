// Session-to-Session — Task 9b (wake-poller registration hook).
//
// A neutral module that breaks the prompt.ts ↔ poller.ts circular import.
// poller.ts registers its wake-poller body at module init; prompt.ts reads
// the function reference at runtime to fork the C′ wake poller.
//
// NO module-level mutable state lives here — the dedup map and scope
// are owned by the per-runtime SessionPrompt layer closure.

import { Effect } from "effect"

let _wakeBody: ((pollMs: number) => Effect.Effect<void>) | undefined

export const registerWakeBody = (fn: (pollMs: number) => Effect.Effect<void>): void => {
  _wakeBody = fn
}

export const wakeBody = (pollMs: number): Effect.Effect<void> => {
  if (!_wakeBody) {
    return Effect.die(new Error("wakeBody not registered — poller.ts must register before first loop entry"))
  }
  return _wakeBody(pollMs)
}

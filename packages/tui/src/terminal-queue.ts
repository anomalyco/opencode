import type { CliRenderer } from "@opentui/core"

// Terminal re-inits (the viewport restart, and the external editor's suspend and resume)
// run one at a time, so they never overlap. A failed step does not block the next one.
const noop = () => {}
const queues = new WeakMap<CliRenderer, Promise<void>>()

export function exclusiveTerminal<T>(renderer: CliRenderer, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(renderer) ?? Promise.resolve()).then(work)
  queues.set(renderer, next.then(noop, noop))
  return next
}

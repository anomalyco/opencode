import type { SessionRef } from "@opencode/plugin/gui"
import type { BuiltinPromptGate } from "@opencode/plugin/gui/builtin"

/** How long a prompt waits for the plugins' gates before it is sent anyway. */
export const PROMPT_GATE_TIMEOUT_MS = 2_000

/** Resolves once every gate settled or the timeout passed, whichever is first; it never rejects. */
export function settlePromptGates(gates: readonly BuiltinPromptGate[], session: SessionRef) {
  if (gates.length === 0) return Promise.resolve()
  const controller = new AbortController()
  const settled = Promise.withResolvers<void>()
  const timer = setTimeout(settled.resolve, PROMPT_GATE_TIMEOUT_MS)

  // Promise.try keeps a gate that throws to itself, so the others still run.
  void Promise.allSettled(
    gates.map((gate) => Promise.try(() => gate.ready({ session, signal: controller.signal }))),
  ).then(() => settled.resolve())

  return settled.promise.finally(() => {
    clearTimeout(timer)
    controller.abort()
  })
}

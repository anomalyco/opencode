import type { SessionRef } from "@opencode/plugin/gui"
import type { BuiltinPromptGate } from "@opencode/plugin/gui/builtin"

/**
 * How long a prompt waits for the plugins' gates before it is sent anyway. A gate that misses it costs the model one
 * step without what the gate prepared; a second of dead time on Enter is the most that is worth.
 */
export const PROMPT_GATE_TIMEOUT_MS = 1_000

/**
 * Resolves once every gate settled or the timeout passed, whichever is first; it never rejects. Only the gates of
 * plugins that ship with the app are asked (`builtin`): the registry is theirs alone, and a plugin bundle that adds
 * an item under its id would otherwise hold every prompt and learn which session it goes to.
 */
export function settlePromptGates(
  items: readonly { readonly plugin: string; readonly value: BuiltinPromptGate }[],
  builtin: (plugin: string) => boolean,
  session: SessionRef,
) {
  const gates = items.flatMap((item) => (builtin(item.plugin) ? [item.value] : []))

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

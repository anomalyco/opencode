export * as ToolInterrupted from "./interrupted.js"

import { Context, Effect } from "effect"
import type { NormalizedResult } from "../tool.js"

/**
 * Lets a tool whose call is interrupted still settle it with a result.
 *
 * An interrupted fiber fails as soon as it re-enters an interruptible region, so a tool that finishes its
 * work uninterruptibly cannot return a value through the caller. It reports the result here instead,
 * before returning; the session step settles the call with it and still ends as interrupted.
 */
export type Slot = { result?: NormalizedResult }

export const Slot = Context.Reference<Slot | undefined>("@opencode/ToolInterrupted/Slot", {
  defaultValue: () => undefined,
})

export const report = Effect.fnUntraced(function* (result: NormalizedResult) {
  const slot = yield* Slot
  if (slot) slot.result = result
})

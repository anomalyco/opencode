import { Browser } from "@opencode/plugin-browser/rpc"
import { Option, Schema } from "effect"

/** Do not echo schema diagnostics: they can contain page text and file contents. A command may already have run. */
export const invalidReply = {
  type: "failure",
  code: "invalid_result",
  message: "The desktop could not encode the browser result. Inspect the tab before retrying the operation.",
} as const

export function wireOutcome(outcome: Browser.Outcome) {
  return Option.getOrElse(Schema.encodeOption(Browser.Outcome)(outcome), () => invalidReply)
}

/** State also appears inside the JSON value returned by tabs.list: validate both contracts. */
export function wireState(state: Browser.State) {
  const encoded = Option.getOrUndefined(Schema.encodeOption(Browser.State)(state))

  return encoded && Schema.is(Schema.Json)(encoded) ? encoded : undefined
}

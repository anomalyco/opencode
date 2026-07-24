export * as CodeModeInstructions from "./instructions"

import { Effect, Schema } from "effect"
import { Instructions } from "../instructions/index"

const key = Instructions.Key.make("core/codemode")
const codec = Schema.toCodecJson(Schema.String)
const render = {
  initial: (current: string) => current,
  changed: (_previous: string, current: string) =>
    [
      "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.",
      current,
    ].join("\n\n"),
  removed: () => "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
}

export const make = (content?: string): Instructions.Instructions =>
  Instructions.make({
    key,
    codec,
    read: Effect.succeed(content ?? Instructions.removed),
    render,
  })

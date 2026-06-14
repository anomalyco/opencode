import { run as runTui, type TuiInput } from "@daemon-protocol/tui"
import { Global } from "@daemon-protocol/core/global"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(Global.defaultLayer))
}

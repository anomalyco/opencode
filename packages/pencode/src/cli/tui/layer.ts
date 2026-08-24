import { run as runTui, type TuiInput } from "@pencode-ai/tui"
import { Global } from "@pencode-ai/core/global"
import { AppNodeBuilder } from "@pencode-ai/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}

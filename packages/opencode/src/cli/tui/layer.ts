import { run as runTui, type TuiInput } from "@leak-code/tui"
import { Global } from "@leak-code/core/global"
import { AppNodeBuilder } from "@leak-code/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}

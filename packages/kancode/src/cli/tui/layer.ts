import { run as runTui, type TuiInput } from "@kancode/tui"
import { Global } from "@kancode/core/global"
import { AppNodeBuilder } from "@kancode/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}

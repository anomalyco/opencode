import { run as runTui, type TuiInput } from "@moks/tui"
import { Global } from "@moks/core/global"
import { AppNodeBuilder } from "@moks/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}

import type { Agent } from "../agent/agent"
import { runtime } from "@/effect/runtime"
import * as Mod from "./truncate-effect"

const output = async (text: string, options: Truncate.Options = {}, agent?: Agent.Info): Promise<Truncate.Result> => {
  return runtime.runPromise(Mod.Truncate.Service.use((s) => s.output(text, options, agent)))
}

export const Truncate = {
  MAX_LINES: Mod.Truncate.MAX_LINES,
  MAX_BYTES: Mod.Truncate.MAX_BYTES,
  DIR: Mod.Truncate.DIR,
  GLOB: Mod.Truncate.GLOB,
  output,
}

export namespace Truncate {
  export type Result = Mod.Truncate.Result
  export type Options = Mod.Truncate.Options
}

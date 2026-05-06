import { Effect, Stream } from "effect"
import type { Tools } from "../../src/tool"
import { ToolRuntime, type RunOptions } from "../../src/tool-runtime"

export const runTools = <T extends Tools>(options: RunOptions<T>) =>
  Stream.unwrap(Effect.gen(function* () {
    return (yield* ToolRuntime.Service).run(options)
  }))

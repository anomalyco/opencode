import os from "os"
import path from "path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type { ToolFile, ToolSignature } from "./types"

export class ToolRuntimeError extends Schema.TaggedErrorClass<ToolRuntimeError>()("ToolRuntimeError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

interface ToolInstance {
  fn: (args: any) => any
  signature: ToolSignature
}

export interface ToolRuntimeInterface {
  register(name: string, filePath: string): Effect.Effect<ToolSignature, ToolRuntimeError>
  execute(name: string, args: unknown): Effect.Effect<unknown, ToolRuntimeError>
  unregister(name: string): Effect.Effect<void, ToolRuntimeError>
  reload(name: string, filePath: string): Effect.Effect<ToolSignature, ToolRuntimeError>
  list(): Effect.Effect<ToolSignature[], ToolRuntimeError>
  isRegistered(name: string): Effect.Effect<boolean, never>
}

const buildAndImport = Effect.fn("ToolRuntime.buildAndImport")(function* (name: string, filePath: string) {
  const outdir = path.join(os.tmpdir(), "opencode-tools", `${name}-${Date.now()}`)

  const result = yield* Effect.tryPromise({
    try: async () => {
      const out = await Bun.build({
        entrypoints: [filePath],
        outdir,
        format: "esm",
      })
      if (out.logs.length > 0) {
        throw new AggregateError(out.logs, out.logs.map((l) => l.message).join("; "))
      }
      return out
    },
    catch: (cause) => new ToolRuntimeError({ message: `Failed to build tool "${name}": ${cause}`, cause }),
  })

  const outFile = result.outputs[0]
  if (!outFile) {
    return yield* new ToolRuntimeError({ message: `Build produced no output for tool "${name}"` })
  }

  const mod = yield* Effect.tryPromise({
    try: () => import(outFile.path),
    catch: (cause) => new ToolRuntimeError({ message: `Failed to load built tool "${name}"`, cause }),
  })

  const toolFile = mod as { tool?: ToolFile; default?: (args: any) => any }
  if (!toolFile.tool) {
    return yield* new ToolRuntimeError({ message: `Tool "${name}" missing 'tool' export` })
  }
  if (typeof mod.default !== "function") {
    return yield* new ToolRuntimeError({ message: `Tool "${name}" missing default export function` })
  }

  const signature: ToolSignature = {
    name: toolFile.tool.name,
    description: toolFile.tool.description,
    input: toolFile.tool.schema.input,
    output: toolFile.tool.schema.output,
  }

  return { fn: mod.default as (args: any) => any, signature }
})

export class ToolRuntime extends Context.Service<ToolRuntime, ToolRuntimeInterface>()(
  "@opencode-ai/database/ToolRuntime",
) {
  static layer = Layer.effect(
    ToolRuntime,
    Effect.sync(() => {
      const tools = new Map<string, ToolInstance>()

      return ToolRuntime.of({
        register: Effect.fn("ToolRuntime.register")(function* (name, filePath) {
          const instance = yield* buildAndImport(name, filePath)
          tools.set(name, instance)
          return instance.signature
        }),

        execute: Effect.fn("ToolRuntime.execute")(function* (name, args) {
          const tool = tools.get(name)
          if (!tool) {
            return yield* new ToolRuntimeError({ message: `Tool "${name}" not registered` })
          }
          return yield* Effect.try({
            try: () => tool.fn(args),
            catch: (cause) => new ToolRuntimeError({ message: `Tool "${name}" execution failed`, cause }),
          })
        }),

        unregister: Effect.fn("ToolRuntime.unregister")(function* (name) {
          tools.delete(name)
        }),

        reload: Effect.fn("ToolRuntime.reload")(function* (name, filePath) {
          tools.delete(name)
          const instance = yield* buildAndImport(name, filePath)
          tools.set(name, instance)
          return instance.signature
        }),

        list: Effect.fn("ToolRuntime.list")(function* () {
          return Array.from(tools.values()).map((t) => t.signature)
        }),

        isRegistered: Effect.fn("ToolRuntime.isRegistered")(function* (name) {
          return tools.has(name)
        }),
      })
    }),
  )
}

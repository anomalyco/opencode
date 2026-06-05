import path from "path"
import { Glob } from "@opencode-ai/core/util/glob"
import { ToolRuntime, ToolRuntimeError } from "@opencode-ai/database/tool/runtime"
import { Tool } from "./tool"
import { Effect, Schema } from "effect"
import z from "zod"
import type { JSONSchema7 } from "@ai-sdk/provider"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tool.dynamic" })

const typeToJsonSchema = (typeName: string): JSONSchema7["type"] =>
  typeName === "number" ? "number" : typeName === "boolean" ? "boolean" : "string"

const toJsonSchema = (input: Record<string, string>): JSONSchema7 => {
  const properties: Record<string, JSONSchema7> = {}
  for (const [k, t] of Object.entries(input)) properties[k] = { type: typeToJsonSchema(t) }
  return { type: "object", properties, required: Object.keys(properties) }
}

const toZod = (input: Record<string, string>): z.ZodType => {
  const shape: Record<string, z.ZodType> = {}
  for (const [k, t] of Object.entries(input))
    shape[k] = t === "number" ? z.number() : t === "boolean" ? z.boolean() : z.string()
  return z.object(shape)
}

export const resolveDynamic = Effect.fn("DynamicTools.resolve")(function* () {
  const runtime = yield* ToolRuntime
  yield* initDynamic()
  const signatures = yield* runtime.list()

  return signatures.map((sig) => {
    const zod = toZod(sig.input)
    const def: Tool.Def = {
      id: sig.name,
      description: sig.description,
      jsonSchema: toJsonSchema(sig.input),
      parameters: Schema.declare<unknown>((u): u is unknown => zod.safeParse(u).success),
      execute: (args: any) =>
        runtime.execute(sig.name, args).pipe(
          Effect.catchTag("ToolRuntimeError", (e: ToolRuntimeError) => Effect.succeed({ error: e.message })),
          Effect.map((result): Tool.ExecuteResult => {
            const output = typeof result === "string" ? result : JSON.stringify(result, null, 2)
            return { title: sig.name, output, metadata: {} }
          }),
        ),
    }
    return def
  })
})

export const resolveDynamicCatalog = Effect.fn("DynamicTools.resolveCatalog")(function* () {
  const runtime = yield* ToolRuntime
  yield* initDynamic()
  const signatures = yield* runtime.listCatalog()

  return signatures.map((sig) => {
    const zod = toZod(sig.input)
    const def: Tool.Def = {
      id: sig.name,
      description: sig.description,
      jsonSchema: toJsonSchema(sig.input),
      parameters: Schema.declare<unknown>((u): u is unknown => zod.safeParse(u).success),
      execute: (args: any) =>
        runtime.execute(sig.name, args).pipe(
          Effect.catchTag("ToolRuntimeError", (e: ToolRuntimeError) => Effect.succeed({ error: e.message })),
          Effect.map((result): Tool.ExecuteResult => {
            const output = typeof result === "string" ? result : JSON.stringify(result, null, 2)
            return { title: sig.name, output, metadata: {} }
          }),
        ),
    }
    return def
  })
})

export const syncDynamic = Effect.fn("DynamicTools.sync")(function* (runtime: ToolRuntime) {
  const matches = Glob.scanSync("tools/*.ts", { cwd: process.cwd(), absolute: true, dot: true, symlink: true })
  if (matches.length === 0) return

  for (const match of matches) {
    const name = path.basename(match, path.extname(match))
    const already = yield* runtime.isRegistered(name)
    if (already) continue

    yield* runtime
      .register(name, match)
      .pipe(
        Effect.catchTag("ToolRuntimeError", (e: ToolRuntimeError) =>
          Effect.sync(() => log.warn("failed to register tool", { name, error: e.message })),
        ),
      )
  }
})

export const initDynamic = Effect.fn("DynamicTools.init")(function* () {
  const runtime = yield* ToolRuntime
  yield* syncDynamic(runtime)
})

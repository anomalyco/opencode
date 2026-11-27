export * as CodeModeSavedTools from "./saved-tools.js"

import { CodeMode, Extension } from "@opencode/codemode"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { isRecord } from "@opencode/util/record"
import { and, eq, inArray } from "drizzle-orm"
import { Context, Effect, JsonSchema, Layer, PubSub, Ref, Result, Schema, Scope, Stream } from "effect"
import { Database } from "../database/database.js"
import { Instructions } from "../instructions/index.js"
import { CodeModeAgents } from "./agents.js"
import { SavedToolTable } from "./sql.js"

/** The namespace saved tools are called under: `tools.opencode.<name>`. */
export const NAMESPACE = "opencode"

/** The scope of a tool every project sees. Not a project ID: folders outside a project share the ID `global`. */
export const GLOBAL = "*"

/** How deep saved tools may call saved tools. */
export const MAX_DEPTH = 4

/** How many saved tools are running inside each other; see `MAX_DEPTH`. */
export const Depth = Context.Reference<number>("@opencode/CodeModeSavedTools/Depth", { defaultValue: () => 0 })

export interface Saved {
  /** A project ID, or `GLOBAL`. */
  readonly scope: string
  readonly name: string
  readonly description: string
  readonly input: JsonSchema.JsonSchema
  readonly output?: JsonSchema.JsonSchema
  /** The source of the `run` function. */
  readonly code: string
}

export interface StoreInterface {
  /** The project's tools and the global ones; a project tool hides a global one of the same name. */
  readonly list: (projectID: string) => Effect.Effect<ReadonlyArray<Saved>>
  readonly save: (tool: Saved) => Effect.Effect<void>
  /** Removes the tool from the first of `scopes` that has it; false when none has it. */
  readonly remove: (scopes: ReadonlyArray<string>, name: string) => Effect.Effect<boolean>
  /** The scope of every save or remove, in any project, so each Location can reload the tools it sees. */
  readonly changes: Stream.Stream<string>
}

export class Store extends Context.Service<Store, StoreInterface>()("@opencode/CodeModeSavedTools/Store") {}

const storeLayer = Layer.effect(
  Store,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const changed = yield* PubSub.unbounded<string>()
    return Store.of({
      list: Effect.fn("CodeModeSavedTools.list")(function* (projectID) {
        const rows = yield* db
          .select({
            scope: SavedToolTable.scope,
            name: SavedToolTable.name,
            description: SavedToolTable.description,
            input: SavedToolTable.input,
            output: SavedToolTable.output,
            code: SavedToolTable.code,
          })
          .from(SavedToolTable)
          .where(inArray(SavedToolTable.scope, [projectID, GLOBAL]))
          .all()
          .pipe(Effect.orDie)
        const own = new Set(rows.filter((row) => row.scope !== GLOBAL).map((row) => row.name))
        return rows
          .filter((row) => row.scope !== GLOBAL || !own.has(row.name))
          .map((row) => ({ ...row, output: row.output ?? undefined }))
      }),
      save: Effect.fn("CodeModeSavedTools.save")(function* (tool) {
        const values = {
          description: tool.description,
          input: tool.input,
          output: tool.output ?? null,
          code: tool.code,
        }
        yield* db
          .insert(SavedToolTable)
          .values({ scope: tool.scope, name: tool.name, ...values })
          .onConflictDoUpdate({
            target: [SavedToolTable.scope, SavedToolTable.name],
            set: { ...values, time_updated: Date.now() },
          })
          .run()
          .pipe(Effect.orDie)
        yield* PubSub.publish(changed, tool.scope)
      }),
      remove: Effect.fn("CodeModeSavedTools.remove")(function* (scopes, name) {
        for (const scope of scopes) {
          const removed = yield* db
            .delete(SavedToolTable)
            .where(and(eq(SavedToolTable.scope, scope), eq(SavedToolTable.name, name)))
            .returning({ name: SavedToolTable.name })
            .all()
            .pipe(Effect.orDie)
          if (removed.length === 0) continue
          yield* PubSub.publish(changed, scope)
          return true
        }
        return false
      }),
      changes: Stream.fromPubSub(changed),
    })
  }),
)

export const storeNode = makeGlobalNode({ service: Store, layer: storeLayer, deps: [Database.node] })

export interface DefineInput {
  readonly name: string
  readonly description: string
  readonly input: JsonSchema.JsonSchema
  readonly output?: JsonSchema.JsonSchema
  readonly code: string
  readonly global: boolean
}

/** What runs tool.define() and tool.delete() for a Location; the saved-tools plugin provides it. */
export interface Implementation {
  readonly define: (input: DefineInput) => Effect.Effect<void, Error>
  readonly remove: (name: string) => Effect.Effect<boolean>
}

export interface Interface {
  /** Installs the implementation for this Location until the scope closes. */
  readonly register: (implementation: Implementation) => Effect.Effect<void, never, Scope.Scope>
  readonly current: Effect.Effect<Implementation | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CodeModeSavedTools") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const current = yield* Ref.make<Implementation | undefined>(undefined)
    return Service.of({
      register: (implementation) =>
        Effect.acquireRelease(Ref.set(current, implementation), () =>
          Ref.update(current, (value) => (value === implementation ? undefined : value)),
        ).pipe(Effect.asVoid),
      current: Ref.get(current),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })

/** For runs without the `codemode_tools` extension, whose environment still names this service. */
export const unavailable = Service.of({ register: () => Effect.void, current: Effect.succeed(undefined) })

export interface Program {
  readonly code: string
  /** The `tools.<path>`s it calls. */
  readonly tools: ReadonlyArray<string>
}

/**
 * The program a saved tool runs: its `run` called with the `input` binding. `run` is a function expression, or a method
 * (`async run(input) {}`), the other form `Function.prototype.toString` gives. Source that only parses as another
 * expression fails when the tool is called.
 */
export function program(source: string): Result.Result<Program, string> {
  const direct = parse(`return await (${source})(input)`)
  if (Result.isSuccess(direct)) return Result.succeed(direct.success)
  const method = parse(`return await Object.values({ ${source} })[0](input)`)
  if (Result.isSuccess(method)) return Result.succeed(method.success)
  return Result.fail(`run is not a function: ${direct.failure.message}`)
}

const parse = (code: string) =>
  Result.map(CodeMode.scanProgram(code, []), (scanned): Program => ({ code, tools: scanned.tools }))

/** The script's `tool` global: `tool.define(spec)` and `tool.delete(name)`. */
export const extension = Extension.make({
  name: "codemode_tools",
  globals: {
    tool: {
      define: Extension.async((spec: unknown) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(parseSpec(spec))
          const implementation = yield* requireImplementation
          yield* implementation.define(input)
          return { path: `tools.${NAMESPACE}.${input.name}` }
        }),
      ),
      delete: Extension.async((name: unknown) =>
        Effect.gen(function* () {
          if (typeof name !== "string" || name === "")
            return yield* Effect.fail(new TypeError("tool.delete(name) needs the tool's name."))
          const implementation = yield* requireImplementation
          return { deleted: yield* implementation.remove(name) }
        }),
      ),
    },
  },
})

/** A row for the execute call's progress: which tool was defined or deleted. */
export const display = (args: ReadonlyArray<unknown>): Record<string, string> => {
  const first = args[0]
  if (typeof first === "string") return { name: first }
  return isRecord(first) && typeof first.name === "string" ? { name: first.name } : {}
}

const DefineSpec = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]*$/)),
  description: Schema.String.check(Schema.isNonEmpty()),
  input: Schema.Record(Schema.String, Schema.Unknown),
  output: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  run: Schema.String,
  global: Schema.optional(Schema.Boolean),
})

function parseSpec(spec: unknown): Result.Result<DefineInput, TypeError> {
  const decoded = Schema.decodeUnknownResult(DefineSpec)(spec, { errors: "all", onExcessProperty: "error" })
  if (Result.isFailure(decoded))
    return invalid(
      `{ name, description, input, output?, run, global? } is invalid: ${decoded.failure.message}. name is lowercase letters, digits and _; input and output are JSON Schemas; run is an async function's source, as a string.`,
    )
  // Boundary values from a script: `compile` checks they are JSON Schemas Core can validate against.
  const input = decoded.success.input as JsonSchema.JsonSchema
  const output = decoded.success.output as JsonSchema.JsonSchema | undefined
  if (input.type !== "object") return invalid("input must be an object schema.")
  const inputCodec = CodeModeAgents.compile(input, false)
  if (Result.isFailure(inputCodec)) return invalid(`input ${inputCodec.failure}`)
  const outputCodec = output === undefined ? undefined : CodeModeAgents.compile(output, false)
  if (outputCodec !== undefined && Result.isFailure(outputCodec)) return invalid(`output ${outputCodec.failure}`)
  const runnable = program(decoded.success.run)
  if (Result.isFailure(runnable)) return invalid(runnable.failure)
  return Result.succeed({
    name: decoded.success.name,
    description: decoded.success.description,
    input,
    ...(output === undefined ? {} : { output }),
    code: decoded.success.run,
    global: decoded.success.global === true,
  })
}

const invalid = (message: string) => Result.fail(new TypeError(`tool.define(): ${message}`))

const requireImplementation = Effect.gen(function* () {
  const service = yield* Service
  const implementation = yield* service.current
  if (implementation) return implementation
  return yield* Effect.fail(new Error("tool.define() and tool.delete() are not available in this session."))
})

// prettier-ignore
const guide = `## Saved tools in Code Mode

Scripts can save a reusable tool with the \`tool\` global, for this project or with \`global: true\` for every project. \`run\` is the source of an async function, as a template string; \`input\` and \`output\` are JSON Schemas:

\`\`\`js
await tool.define({
  name: "add",
  description: "Adds two numbers.",
  input: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
  run: \`async (input) => input.a + input.b\`,
})
\`\`\`

Later scripts call it as \`tools.${NAMESPACE}.add(input)\`, and \`search\` finds it. Defining an existing name replaces it; \`await tool.delete(name)\` removes it. \`run\` runs on its own: it sees only \`input\` and \`tools\`, not the defining script's variables. Save a tool when the user asks for one.`

const instructionsKey = Instructions.Key.make("core/codemode-saved-tools")
const instructionsCodec = Schema.toCodecJson(Schema.String)

/** The short guide to tool.define() and tool.delete(), sent while the session's Code Mode has them. */
export const instructions = (enabled: boolean): Instructions.List =>
  Instructions.make({
    key: instructionsKey,
    codec: instructionsCodec,
    read: Effect.succeed(enabled ? guide : Instructions.removed),
    render: {
      initial: (text) => text,
      changed: (previous, current) => (previous === current ? undefined : current),
      removed: () => "tool.define() and tool.delete() are no longer available in Code Mode scripts.",
    },
  })

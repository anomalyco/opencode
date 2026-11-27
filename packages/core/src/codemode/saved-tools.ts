export * as CodeModeSavedTools from "./saved-tools.js"

import { CodeMode, Extension } from "@opencode/codemode"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { and, eq, inArray } from "drizzle-orm"
import { Context, Effect, JsonSchema, Layer, PubSub, Ref, Result, Schema, Scope, Stream } from "effect"
import { Database } from "../database/database.js"
import { Instructions } from "../instructions/index.js"
import { CodeModeAgents } from "./agents.js"
import { CodeModeExecution } from "./execution.js"
import { SavedToolTable } from "./sql.js"

/** The namespace saved tools are called under: `tools.opencode.<name>`. */
export const NAMESPACE = "opencode"

/** The scope of a tool every project sees. Not a project ID: folders outside a project share the ID `global`. */
export const GLOBAL = "*"

/** How deep saved tools may call saved tools. */
export const MAX_DEPTH = 4

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
  /** Removes the first of `scopes` that has the tool; false when none has it. */
  readonly remove: (scopes: ReadonlyArray<string>, name: string) => Effect.Effect<boolean>
  /** Emits after every save or remove, in any project, so each Location can reload its tools. */
  readonly changes: Stream.Stream<void>
}

export class Store extends Context.Service<Store, StoreInterface>()("@opencode/CodeModeSavedTools/Store") {}

const storeLayer = Layer.effect(
  Store,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const changed = yield* PubSub.unbounded<void>()
    const columns = {
      scope: SavedToolTable.scope,
      name: SavedToolTable.name,
      description: SavedToolTable.description,
      input: SavedToolTable.input,
      output: SavedToolTable.output,
      code: SavedToolTable.code,
    }
    return Store.of({
      list: Effect.fn("CodeModeSavedTools.list")(function* (projectID) {
        const rows = yield* db
          .select(columns)
          .from(SavedToolTable)
          .where(inArray(SavedToolTable.scope, [projectID, GLOBAL]))
          .all()
          .pipe(Effect.orDie)
        const project = new Set(rows.filter((row) => row.scope !== GLOBAL).map((row) => row.name))
        return rows
          .filter((row) => row.scope !== GLOBAL || !project.has(row.name))
          .map((row) => ({ ...row, output: row.output ?? undefined }))
      }),
      save: Effect.fn("CodeModeSavedTools.save")(function* (tool) {
        const values = { ...tool, output: tool.output ?? null }
        yield* db
          .insert(SavedToolTable)
          .values(values)
          .onConflictDoUpdate({
            target: [SavedToolTable.scope, SavedToolTable.name],
            set: { ...values, time_updated: Date.now() },
          })
          .run()
          .pipe(Effect.orDie)
        yield* PubSub.publish(changed, undefined)
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
          yield* PubSub.publish(changed, undefined)
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

type Execution = CodeModeExecution.Service["Service"]

/** What runs tool.define() and tool.delete() for a Location; the saved-tools plugin provides it. */
export interface Implementation {
  /** Saves the tool and returns the path a script calls it at. */
  readonly define: (input: DefineInput, execution: Execution) => Effect.Effect<string, Error>
  readonly remove: (name: string, execution: Execution) => Effect.Effect<boolean, Error>
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

/** For runs without the `saved_tools` extension, whose environment still names this service. */
export const unavailable = Service.of({ register: () => Effect.void, current: Effect.succeed(undefined) })

/**
 * The program a saved tool runs: its `run` called with the `input` binding. `run` may be any function form
 * `Function.prototype.toString` gives, a method (`async run(input) {}`) included. Fails on source that is none.
 */
export function program(
  code: string,
): Result.Result<{ readonly code: string; readonly tools: ReadonlyArray<string> }, string> {
  const attempts = [`return await (${code})(input)`, `return await Object.values({ ${code} })[0](input)`]
  const failures = attempts.map((attempt) => ({ attempt, scanned: CodeMode.scanProgram(attempt, []) }))
  const parsed = failures.find((item) => Result.isSuccess(item.scanned))
  if (parsed && Result.isSuccess(parsed.scanned))
    return Result.succeed({ code: parsed.attempt, tools: parsed.scanned.success.tools })
  const first = failures[0].scanned
  return Result.fail(`run is not a function: ${Result.isFailure(first) ? first.failure.message : "unknown"}`)
}

const NAME = /^[a-z][a-z0-9_]*$/

const DefineSpec = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(NAME)),
  description: Schema.String.check(Schema.isNonEmpty()),
  input: Schema.Record(Schema.String, Schema.Unknown),
  output: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  run: Schema.String,
  global: Schema.optional(Schema.Boolean),
})

const requireImplementation = Effect.gen(function* () {
  const service = yield* Service
  const implementation = yield* service.current
  if (implementation) return implementation
  return yield* Effect.fail(new Error("tool.define() and tool.delete() are not available in this session."))
})

/** The script's `tool` global: `tool.define(spec)` and `tool.delete(name)`. */
export const extension = Extension.make({
  name: "saved_tools",
  globals: {
    tool: {
      define: Extension.async((spec: unknown) =>
        Effect.gen(function* () {
          const input = yield* parseSpec(spec)
          const implementation = yield* requireImplementation
          const execution = yield* CodeModeExecution.Service
          const path = yield* implementation.define(input, execution)
          return { path: `tools.${path}` }
        }),
      ),
      delete: Extension.async((name: unknown) =>
        Effect.gen(function* () {
          if (typeof name !== "string" || name === "")
            return yield* Effect.fail(new TypeError("tool.delete(name) needs the tool's name."))
          const implementation = yield* requireImplementation
          const execution = yield* CodeModeExecution.Service
          return { deleted: yield* implementation.remove(name, execution) }
        }),
      ),
    },
  },
})

/** A row for the execute call's progress: which tool was defined or deleted. */
export const display = (args: ReadonlyArray<unknown>): Record<string, string> => {
  const first = args[0]
  if (typeof first === "string") return { name: first }
  const name = typeof first === "object" && first !== null && "name" in first ? first.name : undefined
  return typeof name === "string" ? { name } : {}
}

function parseSpec(spec: unknown) {
  const decoded = Schema.decodeUnknownResult(DefineSpec)(spec, { errors: "all", onExcessProperty: "error" })
  if (Result.isFailure(decoded))
    return Effect.fail(
      new TypeError(
        `tool.define({ name, description, input, output?, run, global? }) is invalid: ${decoded.failure.message}. name is lowercase letters, digits and _; input and output are JSON Schemas; run is an async function's source, as a string.`,
      ),
    )
  const value = decoded.success
  // Boundary values from a script: `compile` below checks they are usable JSON Schemas.
  const input = value.input as JsonSchema.JsonSchema
  const output = value.output as JsonSchema.JsonSchema | undefined
  if (input.type !== "object") return Effect.fail(new TypeError("tool.define(): input must be an object schema."))
  const problems = [
    ["input", CodeModeAgents.compile(input, false)],
    ...(output === undefined ? [] : [["output", CodeModeAgents.compile(output, false)] as const]),
  ] as const
  const invalid = problems.find(([, result]) => Result.isFailure(result))
  if (invalid && Result.isFailure(invalid[1]))
    return Effect.fail(new TypeError(`tool.define(): ${invalid[0]} ${invalid[1].failure}`))
  const runnable = program(value.run)
  if (Result.isFailure(runnable)) return Effect.fail(new TypeError(`tool.define(): ${runnable.failure}`))
  return Effect.succeed({
    name: value.name,
    description: value.description,
    input,
    ...(output === undefined ? {} : { output }),
    code: value.run,
    global: value.global === true,
  } satisfies DefineInput)
}

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

Later scripts call it as \`tools.${NAMESPACE}.add(input)\`, and it is listed in the catalog. Defining an existing name replaces it; \`await tool.delete(name)\` removes it. \`run\` runs on its own: it sees only \`input\` and \`tools\`, not the defining script's variables. Save a tool when the user asks for one.`

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

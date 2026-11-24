export * as CodeModeAgents from "./agents.js"

import { Extension } from "@opencode/codemode"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { isRecord } from "@opencode/util/record"
import { Context, Effect, Layer, type JsonSchema, Ref, Result, Schema, SchemaIssue, Scope, Semaphore } from "effect"
import { Instructions } from "../instructions/index.js"
import { codecFor } from "../tool/runtime.js"
import { CodeModeExecution } from "./execution.js"

/** A schema a script passed, ready to send to a model and to check its answer against. */
export interface Output {
  /** Sent to the model. Its root is always an object; another root is wrapped as `{ value }`. */
  readonly json: JsonSchema.JsonSchema
  /** True when `json` wraps the script's schema in `{ value }`, so the answer is unwrapped before the script gets it. */
  readonly wrapped: boolean
  readonly codec: Schema.Codec<unknown>
}

export interface AgentInput {
  readonly prompt: string
  readonly agent?: string
  readonly model?: string
  readonly label?: string
  readonly output?: Output
}

export interface LlmInput {
  readonly prompt: string
  readonly model?: string
  readonly system?: string
  readonly output?: Output
}

/** A failed agent() or llm() call. `limit` marks a usage, quota or rate limit, which stops the run starting more. */
export class CallError extends Schema.TaggedError<CallError>()("CodeModeAgents.CallError", {
  message: Schema.String,
  limit: Schema.Boolean,
}) {}

type Execution = CodeModeExecution.Service["Service"]

/** What runs agent() and llm() for a session; the codemode-agents plugin provides it. */
export interface Implementation {
  readonly agent: (input: AgentInput, execution: Execution) => Effect.Effect<unknown, CallError>
  readonly llm: (input: LlmInput, execution: Execution) => Effect.Effect<unknown, CallError>
}

export interface Interface {
  /** Installs the implementation for this Location until the scope closes. */
  readonly register: (implementation: Implementation) => Effect.Effect<void, never, Scope.Scope>
  readonly current: Effect.Effect<Implementation | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CodeModeAgents") {}

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

/** For runs without the `agents` extension, whose environment still names this service. */
export const unavailable = Service.of({ register: () => Effect.void, current: Effect.succeed(undefined) })

/** Per-run limits. A script that needs more should be split into several runs. */
export const LIMITS = {
  agentConcurrency: 8,
  agentTotal: 100,
  llmConcurrency: 16,
  llmTotal: 500,
}

const OPTIONAL = "~optional"

// prettier-ignore
const guide = `## agent(), llm() and z in Code Mode

Scripts you run with \`execute\` also have these globals:
- \`await agent(prompt, { schema?, agent?, model?, label?, retries? })\` starts a subagent with its own tools and session, waits for it, and returns its final text. With \`schema\`, it returns a value checked against the schema instead.
- \`await llm(prompt, { schema?, system?, model?, retries? })\` makes one model call with no tools and no conversation history: classify, extract, summarize or judge text the script already has. With \`schema\`, it returns a checked value.
- \`z\` builds schemas the way zod does: \`z.object({ file: z.string(), line: z.integer().optional(), severity: z.enum(["low", "high"]) })\`. Plain JSON Schema works too.

Run calls together with \`Promise.all\` or \`Promise.allSettled\`. A script runs at most ${LIMITS.agentConcurrency} agents at once (more wait their turn) and ${LIMITS.agentTotal} in total. A failed call rejects with what went wrong; after a usage or rate limit, no more calls start.

Each agent() is a full subagent run and can cost a lot. Start agents only when the user asks for parallel agents, multi-agent work or a workflow; otherwise describe what a script could do and ask. Before writing a script with agent(), load the \`codemode-agents\` skill.`

const instructionsKey = Instructions.Key.make("core/codemode-agents")
const instructionsCodec = Schema.toCodecJson(Schema.String)

/** The short guide to agent(), llm() and z, sent while the session's Code Mode has them. */
export const instructions = (enabled: boolean): Instructions.List =>
  Instructions.make({
    key: instructionsKey,
    codec: instructionsCodec,
    read: Effect.succeed(enabled ? guide : Instructions.removed),
    render: {
      initial: (text) => text,
      changed: (previous, current) => (previous === current ? undefined : current),
      removed: () => "agent(), llm() and z are no longer available in Code Mode scripts.",
    },
  })

/**
 * The script's `agent`, `llm` and `z` globals. `z` builds JSON Schema the way zod does, as plain objects whose methods
 * (`optional`, `nullable`, `describe`, ...) are host functions; agent() and llm() drop those methods again.
 */
export const extension = Extension.make({
  name: "agents",
  globals: {
    agent: Extension.async((prompt: unknown, options?: unknown) =>
      Effect.gen(function* () {
        const input = yield* parseInput(AgentOptions, "agent", prompt, options)
        const output = yield* parseOutput("agent", input.options?.schema)
        const run = yield* runState
        const implementation = yield* requireImplementation
        const execution = yield* CodeModeExecution.Service
        const call = implementation.agent(
          {
            prompt: input.prompt,
            ...(input.options?.agent === undefined ? {} : { agent: input.options.agent }),
            ...(input.options?.model === undefined ? {} : { model: input.options.model }),
            ...(input.options?.label === undefined ? {} : { label: input.options.label }),
            ...(output === undefined ? {} : { output }),
          },
          execution,
        )
        return yield* limited(run, "agent", input.options?.retries ?? 0, call)
      }),
    ),
    llm: Extension.async((prompt: unknown, options?: unknown) =>
      Effect.gen(function* () {
        const input = yield* parseInput(LlmOptions, "llm", prompt, options)
        const output = yield* parseOutput("llm", input.options?.schema)
        const run = yield* runState
        const implementation = yield* requireImplementation
        const execution = yield* CodeModeExecution.Service
        const call = implementation.llm(
          {
            prompt: input.prompt,
            ...(input.options?.model === undefined ? {} : { model: input.options.model }),
            ...(input.options?.system === undefined ? {} : { system: input.options.system }),
            ...(output === undefined ? {} : { output }),
          },
          execution,
        )
        return yield* limited(run, "llm", input.options?.retries ?? 0, call)
      }),
    ),
    z: {
      string: (options?: unknown) => build({ type: "string", ...keywords(options) }),
      number: (options?: unknown) => build({ type: "number", ...keywords(options) }),
      integer: (options?: unknown) => build({ type: "integer", ...keywords(options) }),
      boolean: () => build({ type: "boolean" }),
      null: () => build({ type: "null" }),
      unknown: () => build({}),
      literal: (value: unknown) => build({ const: value }),
      enum: (values: unknown) => build({ enum: Array.isArray(values) ? values : [] }),
      array: (items: unknown, options?: unknown) => build({ type: "array", items: clean(items), ...keywords(options) }),
      object: (shape: unknown) => object(shape),
      union: (members: unknown) => build({ anyOf: Array.isArray(members) ? members.map(clean) : [] }),
      record: (values: unknown) => build({ type: "object", additionalProperties: clean(values) }),
    },
  },
})

/** A row for the execute call's progress, like fetch's: which global ran, and with what. */
export const display = (name: string, args: ReadonlyArray<unknown>) => {
  const prompt = typeof args[0] === "string" ? args[0] : ""
  const options = isRecord(args[1]) ? args[1] : {}
  return {
    prompt: prompt.length > 200 ? `${prompt.slice(0, 199)}…` : prompt,
    ...(typeof options.label === "string" ? { label: options.label } : {}),
    ...(name === "agent" && typeof options.agent === "string" ? { agent: options.agent } : {}),
    ...(typeof options.model === "string" ? { model: options.model } : {}),
    ...(options.schema !== undefined ? { schema: true } : {}),
  }
}

/**
 * Normalizes a schema from a script: drops `z` methods and markers, wraps a non-object root as `{ value }`, and checks
 * that it is JSON Schema we can validate against. Fails with a message for the script otherwise.
 */
export function output(schema: unknown): Result.Result<Output, string> {
  const cleaned = clean(schema)
  if (!isRecord(cleaned)) return Result.fail("schema must be an object: a z schema or a JSON Schema.")
  // A script's JSON Schema is a boundary value: the codec below is what checks that it is usable.
  const json = cleaned as JsonSchema.JsonSchema
  const wrapped = json.type !== "object"
  const root: JsonSchema.JsonSchema = wrapped
    ? { type: "object", properties: { value: json }, required: ["value"], additionalProperties: false }
    : json
  const codec = codecFor(root)
  if (codec === undefined) return Result.fail("schema is not a JSON Schema this runtime can validate against.")
  return Result.succeed({ json: root, wrapped, codec })
}

/** Checks a model's answer against `output`; the failure lists what to fix, for the model to try again. */
export function check(output: Output, value: unknown): Result.Result<unknown, string> {
  const decoded = Schema.decodeUnknownResult(output.codec)(value, { errors: "all" })
  if (Result.isSuccess(decoded))
    return Result.succeed(output.wrapped && isRecord(decoded.success) ? decoded.success.value : decoded.success)
  const issues = formatter(decoded.failure.issue).issues
  const lines = issues.slice(0, 8).map((issue) => `- ${path(output, issue.path) || "root"}: ${issue.message}`)
  if (issues.length > 8) lines.push(`- ...and ${issues.length - 8} more`)
  return Result.fail(lines.join("\n"))
}

const formatter = SchemaIssue.makeFormatterStandardSchemaV1()

const path = (output: Output, segments: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined) =>
  (segments ?? [])
    .map((segment) => (typeof segment === "object" ? segment.key : segment))
    .slice(output.wrapped ? 1 : 0)
    .reduce<string>(
      (text, key) =>
        typeof key === "number" ? `${text}[${key}]` : text === "" ? String(key) : `${text}.${String(key)}`,
      "",
    )

type Gate = { readonly semaphore: Semaphore.Semaphore; started: number; readonly total: number }

type RunState = {
  readonly agent: Gate
  readonly llm: Gate
  stopped: string | undefined
}

// Keyed by the execution's context object, which each execute call makes anew, so limits are per script run.
const runs = new WeakMap<object, RunState>()

const runState = Effect.map(CodeModeExecution.Service, (execution) => {
  const existing = runs.get(execution)
  if (existing) return existing
  const created: RunState = {
    agent: { semaphore: Semaphore.makeUnsafe(LIMITS.agentConcurrency), started: 0, total: LIMITS.agentTotal },
    llm: { semaphore: Semaphore.makeUnsafe(LIMITS.llmConcurrency), started: 0, total: LIMITS.llmTotal },
    stopped: undefined,
  }
  runs.set(execution, created)
  return created
})

const requireImplementation = Effect.gen(function* () {
  const service = yield* Service
  const implementation = yield* service.current
  if (implementation) return implementation
  return yield* Effect.fail(new Error("agent() and llm() are not available in this session."))
})

// Queues behind the run's concurrency limit, counts toward its total, and retries failures that are not limits. A
// usage or rate limit stops the run from starting more calls of either kind: they would fail the same way.
const limited = (run: RunState, kind: "agent" | "llm", retries: number, call: Effect.Effect<unknown, CallError>) =>
  Effect.gen(function* () {
    const gate = run[kind]
    if (run.stopped !== undefined)
      return yield* Effect.fail(new Error(`${kind}() was not started: an earlier call hit a limit (${run.stopped}).`))
    if (gate.started >= gate.total)
      return yield* Effect.fail(
        new Error(`${kind}() was not started: this script already started ${gate.total}, the most one run may start.`),
      )
    gate.started++
    const attempt = Effect.suspend(() =>
      run.stopped === undefined
        ? call
        : Effect.fail(new CallError({ message: `an earlier call hit a limit (${run.stopped})`, limit: true })),
    )
    return yield* gate.semaphore
      .withPermits(1)(attempt.pipe(Effect.retry({ times: retries, while: (error) => !error.limit })))
      .pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            if (error.limit) run.stopped ??= error.message
          }),
        ),
        Effect.mapError((error) => new Error(error.message)),
      )
  })

const Retries = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }))

const AgentOptions = Schema.Struct({
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
  schema: Schema.optional(Schema.Unknown),
  retries: Schema.optional(Retries),
})

const LlmOptions = Schema.Struct({
  model: Schema.optional(Schema.String),
  system: Schema.optional(Schema.String),
  schema: Schema.optional(Schema.Unknown),
  retries: Schema.optional(Retries),
})

const parseInput = <S extends typeof AgentOptions | typeof LlmOptions>(
  options: S,
  name: string,
  prompt: unknown,
  value: unknown,
) => {
  if (typeof prompt !== "string" || prompt.trim() === "")
    return Effect.fail(new TypeError(`${name}(prompt, options?) needs a non-empty prompt string.`))
  if (value === undefined) return Effect.succeed({ prompt, options: undefined })
  const decoded = Schema.decodeUnknownResult(options)(value, { errors: "all", onExcessProperty: "error" })
  if (Result.isSuccess(decoded)) return Effect.succeed({ prompt, options: decoded.success as S["Type"] })
  const keys = Object.keys(options.fields).join(", ")
  return Effect.fail(
    new TypeError(`${name}() options are invalid (valid options: ${keys}): ${decoded.failure.message}`),
  )
}

const parseOutput = (name: string, schema: unknown) => {
  if (schema === undefined) return Effect.succeed(undefined)
  const result = output(schema)
  if (Result.isSuccess(result)) return Effect.succeed(result.success)
  return Effect.fail(new TypeError(`${name}(): ${result.failure}`))
}

const build = (json: Record<string, unknown>): Record<string, unknown> => ({
  ...json,
  optional: () => build({ ...json, [OPTIONAL]: true }),
  nullable: () => build({ anyOf: [strip(json), { type: "null" }], ...marker(json) }),
  describe: (description: unknown) => build({ ...json, description: String(description) }),
  default: (value: unknown) => build({ ...json, default: value }),
})

const object = (shape: unknown) => {
  const entries = isRecord(shape) ? Object.entries(shape) : []
  return build({
    type: "object",
    properties: Object.fromEntries(entries.map(([key, value]) => [key, clean(value)])),
    required: entries.filter(([, value]) => !(isRecord(value) && value[OPTIONAL] === true)).map(([key]) => key),
    additionalProperties: false,
  })
}

const strip = (json: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(json).filter(([key, value]) => key !== OPTIONAL && typeof value !== "function"))

const marker = (json: Record<string, unknown>) => (json[OPTIONAL] === true ? { [OPTIONAL]: true } : {})

const KEYWORDS = new Set([
  "description",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "format",
])

// Only the keywords that narrow a value; anything else in options is ignored.
const keywords = (options: unknown) =>
  isRecord(options)
    ? Object.fromEntries(
        Object.entries(options).filter(
          ([key, value]) => KEYWORDS.has(key) && (typeof value === "string" || typeof value === "number"),
        ),
      )
    : {}

/** Drops `z` methods and markers at any depth, leaving plain JSON Schema. */
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => key !== OPTIONAL && typeof item !== "function")
      .map(([key, item]) => [key, clean(item)]),
  )
}

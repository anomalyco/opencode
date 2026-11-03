import { Effect, Schema } from "effect"
import { fromJson } from "./data.js"
import type { Extension } from "./extension.js"
import { isLua } from "./extension.js"
import { executeProgram } from "./interpreter/execute.js"
import { extensionGlobals } from "./interpreter/extensions.js"
import { globalNames } from "./interpreter/globals.js"
import { scanTools } from "./scan.js"
import { type Services, type ToolDescription, ToolRuntime } from "./tool-runtime.js"
import type { Tools } from "./tools.js"

export { scanTools }

/** A tool call admitted during an execution. */
export type {
  CallResult,
  ExtensionInvocation,
  Hooks,
  ToolCall,
  ToolDescription,
  ToolInvocation,
} from "./tool-runtime.js"
/** Signature-construction helpers for host-owned catalog instructions. */
export { luaSearchSignature, searchSignature, toolExpression } from "./tool-runtime.js"

/** Resource budgets enforced independently during each CodeMode program execution. */
export type ExecutionLimits = {
  /**
   * Wall-clock milliseconds before interruption. Result delivery waits for tool cleanup.
   * Defaults to two minutes in Lua, no timeout in JavaScript.
   */
  readonly timeoutMs?: number
  /** Lua: host call attempts (tools, search and extensions), default 128. JavaScript: admitted tools, unlimited by default. */
  readonly maxToolCalls?: number
  /**
   * Maximum UTF-8 bytes retained from the result and logs. Warnings have a separate equal budget;
   * truncation notices and host formatting are additional. Defaults to 64 KiB in Lua, unlimited in JavaScript.
   */
  readonly maxOutputBytes?: number
}

export type ResolvedExecutionLimits = {
  readonly timeoutMs: number | undefined
  readonly maxToolCalls: number | undefined
  readonly maxOutputBytes: number | undefined
}

/** Configuration shared by `CodeMode.make` and `CodeMode.execute`. */
export type Options<Provided extends Record<string, unknown> = {}, Extensions extends ReadonlyArray<Extension> = []> = {
  /** Select the parser and runtime explicitly. Existing library callers default to JavaScript. */
  language?: "javascript" | "lua"
  /** Explicit tools exposed to the program as `tools`. */
  tools?: Provided & Tools<Services<Provided>>
  /** Hooks around every tool and extension call the program makes; see `Hooks`. */
  hooks?: ToolRuntime.Hooks<Environment<Provided, Extensions>>
  /** Host functions and objects exposed as globals, also importable by Node module name; see `Extension.make`. */
  extensions?: Extensions
  /** Resource limits enforced on each execution. */
  limits?: ExecutionLimits
}

/** The Effect environment an execution needs: what the tools and the extensions' Effect globals require. */
export type Environment<Provided extends Record<string, unknown>, Extensions extends ReadonlyArray<Extension>> =
  | Services<Provided>
  | Extension.Services<Extensions[number]>

/** Options for one CodeMode execution. */
export type ExecuteOptions<
  Provided extends Record<string, unknown> = {},
  Extensions extends ReadonlyArray<Extension> = [],
> = Options<Provided, Extensions> & {
  /** Source for one program in the selected language. No syntax detection or fallback. */
  code: string
  /** Read-only JSON values bound in the program's outer global scope (shadowable by top-level declarations). */
  bindings?: Readonly<Record<string, DataValue>>
}

/** A JSON value that can cross the confined interpreter boundary. */
export type DataValue = Schema.Json

/** Schema for a host tool input containing CodeMode source. */
export const Input = Schema.Struct({ code: Schema.String })
export type Input = typeof Input.Type

export const DiagnosticKind = Schema.Literals([
  "ParseError",
  "UnsupportedSyntax",
  "UnknownTool",
  "InvalidToolInput",
  "InvalidToolOutput",
  "InvalidDataValue",
  "ToolCallLimitExceeded",
  "TimeoutExceeded",
  "ToolFailure",
  "ExecutionFailure",
  "Truncated",
])
/** Stable categories produced by program, schema, tool, limit, and truncation diagnostics. */
export type DiagnosticKind = typeof DiagnosticKind.Type

export const Diagnostic = Schema.Struct({
  kind: DiagnosticKind,
  message: Schema.String,
  location: Schema.optionalKey(Schema.Struct({ line: Schema.Number, column: Schema.Number })),
  suggestions: Schema.optionalKey(Schema.Array(Schema.String)),
})
/** A normalized program diagnostic safe to return across an agent tool boundary. */
export type Diagnostic = typeof Diagnostic.Type

const ToolCallSchema = Schema.Struct({ name: Schema.String })
export const Success = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Json,
  warnings: Schema.optionalKey(Schema.Array(Diagnostic)),
  logs: Schema.optionalKey(Schema.Array(Schema.String)),
  truncated: Schema.optionalKey(Schema.Boolean),
  toolCalls: Schema.Array(ToolCallSchema),
})
/** Successful execution after the result has crossed the plain-data boundary. */
export type Success = typeof Success.Type

export const Failure = Schema.Struct({
  ok: Schema.Literal(false),
  error: Diagnostic,
  logs: Schema.optionalKey(Schema.Array(Schema.String)),
  truncated: Schema.optionalKey(Schema.Boolean),
  toolCalls: Schema.Array(ToolCallSchema),
})
/** Failed execution with calls admitted before the diagnostic was produced. */
export type Failure = typeof Failure.Type

/** Schema for the structured success or diagnostic returned by CodeMode execution. */
export const Result = Schema.Union([Success, Failure])
/** Result of executing a CodeMode program. Program failures are data, not Effect failures. */
export type Result = typeof Result.Type

/** Reusable confined runtime over explicit tools. */
export type Runtime<R = never> = {
  readonly catalog: ReadonlyArray<ToolDescription>
  readonly execute: (code: string, bindings?: Readonly<Record<string, DataValue>>) => Effect.Effect<Result, never, R>
}

const validateLimit = (name: keyof ExecutionLimits, value: number | undefined, minimum: number): number | undefined => {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) {
    throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`)
  }
  return value
}

const resolveExecutionLimits = (limits?: ExecutionLimits): ResolvedExecutionLimits => ({
  timeoutMs: validateLimit("timeoutMs", limits?.timeoutMs, 1),
  maxToolCalls: validateLimit("maxToolCalls", limits?.maxToolCalls, 0),
  maxOutputBytes: validateLimit("maxOutputBytes", limits?.maxOutputBytes, 0),
})

/** Executes one Effect-native CodeMode program without constructing a reusable runtime. */
export const execute = <
  const Provided extends Record<string, unknown>,
  const Extensions extends ReadonlyArray<Extension> = [],
>(
  options: ExecuteOptions<Provided, Extensions>,
): Effect.Effect<Result, never, Environment<Provided, Extensions>> =>
  make(options).execute(options.code, options.bindings)

/** Creates an Effect-native runtime over explicit, schema-described tools and extensions. */
export const make = <
  const Provided extends Record<string, unknown> = {},
  const Extensions extends ReadonlyArray<Extension> = [],
>(
  options: Options<Provided, Extensions> = {},
): Runtime<Environment<Provided, Extensions>> => {
  if (options.language !== undefined && options.language !== "lua" && options.language !== "javascript") {
    throw new TypeError(`Unsupported Code Mode language '${options.language}'.`)
  }
  const prepared = ToolRuntime.prepare<Environment<Provided, Extensions>>(
    (options.tools ?? {}) as Tools<Services<Provided>>,
    options.language,
  )
  const limits = resolveExecutionLimits(options.limits)
  const extensions = options.extensions ?? []
  if (options.language === "lua") {
    const hooks = options.hooks ?? {}
    const globals = luaGlobals(extensions, hooks)
    const budget = {
      timeoutMs: limits.timeoutMs ?? 120_000,
      maxToolCalls: limits.maxToolCalls ?? 128,
      maxOutputBytes: limits.maxOutputBytes ?? 65_536,
    }
    return {
      get catalog() {
        return prepared.catalog
      },
      execute: (code, bindings) =>
        Effect.gen(function* () {
          const { executeLua } = yield* Effect.promise(() => import("./lua.js"))
          return yield* executeLua(code, prepared, budget, hooks, bindings, globals)
        }),
    }
  }
  const bound = new Set(globalNames)
  for (const extension of extensions) {
    if (isLua(extension)) throw new TypeError("A Lua extension requires language: 'lua'.")
    for (const name of Object.keys(extension.globals)) {
      if (bound.has(name)) throw new TypeError(`Extension "${extension.name}" global "${name}" is already defined.`)
      bound.add(name)
    }
  }
  return {
    get catalog() {
      return prepared.catalog
    },
    execute: (code, bindings) =>
      executeProgram(code, prepared, limits, options.hooks ?? {}, (ctx) => [
        ...Object.entries(bindings ?? {}).map(([name, value]) => [name, fromJson(ctx, value)] as const),
        ...extensionGlobals(ctx, extensions),
      ]),
  }
}

// Only these exact names may enter host code. The Lua bridge copies arguments and checks
// return values as bounded JSON; unlike the JavaScript extension API there are no object methods.
function luaGlobals<R>(extensions: ReadonlyArray<Extension>, hooks: ToolRuntime.Hooks<R>) {
  const globals = new Map<string, (args: Array<DataValue | undefined>) => Effect.Effect<unknown, unknown, R>>()
  for (const extension of extensions) {
    if (!isLua(extension))
      throw new TypeError(`Declare Lua capabilities with Extension.lua (extension '${extension.name}').`)
    for (const [name, fn] of Object.entries(extension.globals)) {
      if (globals.has(name)) throw new TypeError(`Duplicate Lua extension global '${name}'.`)
      // The extension's concrete environment is already included in R by Extension.Services.
      const call = fn as (...args: Array<DataValue | undefined>) => Effect.Effect<DataValue | undefined, unknown, R>
      globals.set(name, (args) =>
        ToolRuntime.hooked(
          { extension: extension.name, name, args },
          hooks["extension.before"],
          hooks["extension.after"],
          Effect.suspend(() => call(...args)),
        ),
      )
    }
  }
  return globals
}

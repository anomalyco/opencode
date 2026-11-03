import { Buffer } from "node:buffer"
import { isProxy } from "node:util/types"
import { Cause, Effect } from "effect"
import { evaluateLua, hostFailure, LuaFault } from "./lua-sandbox.js"
import type { Diagnostic, ResolvedExecutionLimits, Result } from "./codemode.js"
import type { Json } from "./data.js"
import { boundOutput } from "./interpreter/execute.js"
import { copyLuaData, isLuaDataLimit, LuaDataError, luaErrorMessage } from "./lua-data.js"
import { ToolError } from "./tool-error.js"
import { ToolRuntime } from "./tool-runtime.js"

/** Each next() runs guest instructions until a slice, an explicit capability call, or return.
 * Host work stays on this fiber: interruption/timeout waits for the same hook and tool cleanup as JS. */
export function executeLua<R>(
  code: string,
  prepared: ToolRuntime.Prepared<R>,
  limits: ResolvedExecutionLimits,
  hooks: ToolRuntime.Hooks<R>,
  bindings?: Readonly<Record<string, Json>>,
  globals?: ReadonlyMap<string, (args: Array<Json | undefined>) => Effect.Effect<unknown, unknown, R>>,
): Effect.Effect<Result, never, R> {
  return Effect.suspend(() => {
    const tools = ToolRuntime.make(prepared, limits.maxToolCalls, hooks, {
      copy: copyLuaData,
      message: luaErrorMessage,
      isLimit: isLuaDataLimit,
    })
    const logs: Array<string> = []
    const logLimit = Math.min(1_048_576, limits.maxOutputBytes ?? Infinity)
    let logBytes = 0
    let omitted = 0
    const metadata = () => ({
      toolCalls: tools.calls,
      ...(omitted
        ? { logs: [...logs, `[logs truncated: ${omitted} lines omitted]`], truncated: true }
        : logs.length
          ? { logs }
          : {}),
    })

    const run = Effect.gen(function* () {
      const data = copyLuaData(bindings === undefined ? {} : bindings)
      if (!isRecord(data)) throw new LuaDataError("Expected Lua bindings to be a JSON record.")
      const paths = [["tools"], ["search"], ["print"], ...Array.from(globals?.keys() ?? [], (key) => [key])]
      const vm = evaluateLua(code, { paths, bindings: data })
      return yield* Effect.gen(function* () {
        let resume: Json | undefined | ReturnType<typeof hostFailure>
        while (true) {
          const step = vm.next(resume)
          if (step.done) return { ok: true, value: step.value ?? null, ...metadata() } satisfies Result
          resume = undefined
          if (step.value.type === "tick") {
            yield* Effect.yieldNow
            continue
          }
          const { path, args } = step.value
          if (path.length === 1 && path[0] === "print") {
            if (omitted || logBytes >= logLimit) {
              omitted++
              continue
            }
            const line = args
              .map((v) => (v === undefined ? "nil" : typeof v === "string" ? v : JSON.stringify(v)))
              .join("\t")
            logBytes += Buffer.byteLength(line) + 1
            if (logBytes <= logLimit) logs.push(line)
            else omitted++
            continue
          }
          const dispatch = Effect.suspend(() => {
            if (path[0] === "tools") return tools.execute(path.slice(1), args)
            if (path.length !== 1) throw new Error("Unknown Lua capability.")
            if (path[0] === "search") return tools.search(args)
            const call = globals?.get(path[0])
            if (!call) throw new Error("Unknown Lua capability.")
            tools.admit()
            return Effect.map(call(args), copyLuaData)
          })
          resume = yield* step.value.protected ? dispatch.pipe(Effect.catchCause(recoverHostFailure)) : dispatch
        }
      }).pipe(Effect.ensuring(Effect.sync(() => vm.return(undefined))))
    })

    const timeout = limits.timeoutMs
    return (
      timeout === undefined
        ? run
        : run.pipe(
            Effect.timeoutOrElse({
              duration: timeout,
              orElse: () =>
                Effect.succeed({
                  ok: false,
                  error: { kind: "TimeoutExceeded", message: `Execution timed out after ${timeout}ms.` },
                  ...metadata(),
                } satisfies Result),
            }),
          )
    ).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? Effect.interrupt
          : Effect.succeed({
              ok: false,
              error: diagnostic(Cause.squash(cause)),
              ...metadata(),
            } satisfies Result),
      ),
      Effect.map((result) =>
        limits.maxOutputBytes === undefined ? result : boundOutput(result, limits.maxOutputBytes),
      ),
    )
  })
}

function recoverHostFailure(cause: Cause.Cause<unknown>) {
  // A hook/finalizer can contribute a second reason. A budget or interruption
  // remains fatal even if it isn't the reason squash() would select.
  for (const reason of cause.reasons) {
    if (reason._tag === "Interrupt") return Effect.failCause(cause)
    const error = reason._tag === "Fail" ? reason.error : reason.defect
    if (isLuaDataLimit(error) || ToolRuntime.isBudgetFailure(error)) return Effect.failCause(cause)
  }
  return Effect.succeed(hostFailure(luaErrorMessage(Cause.squash(cause))))
}

function isRecord(value: Json | undefined): value is Readonly<Record<string, Json>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function diagnostic(error: unknown): Diagnostic {
  const message = luaErrorMessage(error)
  if (error !== null && typeof error === "object" && !isProxy(error)) {
    const proto = Object.getPrototypeOf(error)
    if (proto === LuaDataError.prototype || isLuaDataLimit(error)) return { kind: "InvalidDataValue", message }
    if (proto === ToolError.prototype) return { kind: "ToolFailure", message }
    // Hooks can fail with any value, including an error with forged prototype
    // or accessor properties. Read diagnostic metadata as bounded own data.
    const kind: unknown = Object.getOwnPropertyDescriptor(error, "kind")?.value
    if (
      proto === LuaFault.prototype &&
      (kind === "ParseError" ||
        kind === "UnsupportedSyntax" ||
        kind === "ExecutionFailure" ||
        kind === "InvalidDataValue")
    ) {
      const loc: unknown = Object.getOwnPropertyDescriptor(error, "location")?.value
      if (typeof loc === "object" && loc !== null && !isProxy(loc)) {
        const line: unknown = Object.getOwnPropertyDescriptor(loc, "line")?.value
        const column: unknown = Object.getOwnPropertyDescriptor(loc, "column")?.value
        if (
          typeof line === "number" &&
          typeof column === "number" &&
          Number.isSafeInteger(line) &&
          Number.isSafeInteger(column)
        )
          return { kind, message, location: { line, column } }
      }
      return { kind, message }
    }
    if (
      proto === ToolRuntime.ToolRuntimeError.prototype &&
      (kind === "UnknownTool" ||
        kind === "InvalidToolInput" ||
        kind === "InvalidToolOutput" ||
        kind === "ToolCallLimitExceeded")
    ) {
      const hints: unknown = Object.getOwnPropertyDescriptor(error, "suggestions")?.value
      const hint: unknown =
        hints && !isProxy(hints) && Array.isArray(hints) && Object.getOwnPropertyDescriptor(hints, "0")?.value
      return { kind, message, ...(typeof hint === "string" ? { suggestions: [hint.slice(0, 2048)] } : {}) }
    }
  }
  return { kind: "ExecutionFailure", message }
}

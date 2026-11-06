import path from "node:path"
import { pathToFileURL } from "node:url"
import { parse, type Program } from "acorn"
import type { DataValue, Diagnostic, Result } from "../../src/codemode.js"
import { normalizeError } from "../../src/vm/runtime/errors.js"
import { createBuiltins } from "../../src/vm/runtime/intrinsics.js"
import { Interpreter } from "../../src/vm/runtime/interpreter.js"
import { formatLocation, PendingThrow, sourceLocation } from "../../src/vm/runtime/model.js"
import type { Value } from "../../src/vm/runtime/objects.js"
import { Interruption } from "../../src/vm/runtime/signals.js"
import { Source } from "../../src/vm/runtime/source.js"
import type { ToolRuntime } from "../../src/tool-runtime.js"
import type { Snapshot } from "../../src/vm/snapshot/snapshot.js"

/** A quoted `file:` URL for a module relative to `test/vm`, to import from a script run with `bun -e` on any platform. */
export const moduleUrl = (relative: string) =>
  JSON.stringify(pathToFileURL(path.join(import.meta.dir, relative)).href)

const emptyTools = {
  calls: [],
  keys: () => [],
} as unknown as ToolRuntime<never>

export type RunOptions = {
  readonly globals?: (ctx: Interpreter<never>) => ReadonlyArray<readonly [string, Value]>
  readonly bindings?: (ctx: Interpreter<never>) => ReadonlyArray<readonly [string, Value]>
  readonly maxSlices?: number
  /**
   * Round-trip mode: slice after every `every` fuel ticks, then save the state as JSON and continue in a fresh runtime
   * restored from it, at most `max` times (default 200).
   */
  readonly roundTrip?: { readonly every: number; readonly max?: number }
  /** Called with each snapshot round-trip mode takes. */
  readonly onTrip?: (snapshot: Snapshot) => void
}

export const parseVmSource = (
  code: string,
  id = "main",
):
  | { readonly ok: true; readonly program: Program; readonly source: Source }
  | { readonly ok: false; readonly error: Diagnostic } => {
  if (code.trim().length === 0) {
    return { ok: false, error: { kind: "ParseError", message: "Code cannot be empty." } }
  }
  try {
    const program = parse(code, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowImportExportEverywhere: true,
      locations: true,
    })
    const exported = program.body.find((statement) => statement.type.startsWith("Export"))
    if (exported) {
      const location = sourceLocation(exported)
      return {
        ok: false,
        error: {
          kind: "ParseError",
          message: `SyntaxError: Exports aren't available. Return the result instead.${formatLocation(location)}`,
          location,
        },
      }
    }
    return { ok: true, program, source: new Source(id, code, program) }
  } catch (error) {
    if (error instanceof SyntaxError && "loc" in error) {
      const loc = (error as SyntaxError & { readonly loc: { readonly line: number; readonly column: number } }).loc
      const location = { line: loc.line, column: loc.column + 1 }
      const reason = error.message.replace(/ \(\d+:\d+\)$/, "")
      const text = `${reason.endsWith(".") ? reason : `${reason}.`} Code must be plain JavaScript written as a program body.`
      return {
        ok: false,
        error: { kind: "ParseError", message: `SyntaxError: ${text}${formatLocation(location)}`, location },
      }
    }
    if (error instanceof RangeError) {
      return { ok: false, error: normalizeError(error) }
    }
    throw error
  }
}

/** Runs a program on the VM synchronously, with no Effect and no tools: the VM tests' runner. */
export const runProgram = (code: string, options?: RunOptions): Result => {
  const parsed = parseVmSource(code)
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, toolCalls: [] }
  }
  const runtime = (bindings: RunOptions["bindings"]) =>
    new Interpreter<never>({
      tools: emptyTools,
      builtins: createBuiltins(),
      logs: [],
      globals: options?.globals,
      bindings,
    })
  let ctx = runtime(options?.bindings)
  let vm = ctx.vm
  vm.start(parsed.source)
  const roundTrip = options?.roundTrip
  let trips = 0
  if (roundTrip !== undefined) vm.tripEvery = roundTrip.every
  const maxSlices = options?.maxSlices ?? 5000
  let slices = 0
  while (true) {
    const stop = vm.run()
    if (stop.kind === "slice") {
      if (roundTrip !== undefined && vm.tripEvery > 0) {
        const { snapshot } = vm.capture({ strict: true })
        options?.onTrip?.(snapshot)
        ctx = runtime(undefined)
        vm = ctx.vm
        vm.restore(JSON.parse(JSON.stringify(snapshot)), {
          parse: (code) => {
            const again = parseVmSource(code)
            if (!again.ok) throw new Error(again.error.message)
            return again.source
          },
          interruption: () => {
            throw new Error("No interruption is saved in round-trip mode.")
          },
        })
        vm.tripEvery = ++trips < (roundTrip.max ?? 200) ? roundTrip.every : 0
        continue
      }
      if (++slices > maxSlices) {
        return {
          ok: false,
          error: { kind: "TimeoutExceeded", message: "Execution timed out." },
          ...(ctx.logs.length > 0 ? { logs: [...ctx.logs] } : {}),
          toolCalls: [],
        }
      }
      continue
    }
    if (stop.kind === "done") {
      const outcome = stop.completion
      const logsPart = ctx.logs.length > 0 ? { logs: [...ctx.logs] } : {}
      if (!outcome.ok) {
        if (outcome.error instanceof Interruption) throw outcome.error
        return {
          ok: false,
          error: normalizeError(outcome.error),
          ...logsPart,
          toolCalls: [],
        }
      }
      const result = (outcome.value as DataValue | undefined) ?? null
      const warnings = vm.diagnostics()
      return {
        ok: true,
        value: result,
        ...(warnings.length > 0 ? { warnings } : {}),
        ...logsPart,
        toolCalls: [],
      }
    }
    const stuckNode = stop.kind === "stuck" ? stop.node : undefined
    return {
      ok: false,
      error: normalizeError(
        new PendingThrow(
          "Error",
          "The program is waiting on a promise that can never settle: nothing else is running, so nothing can resolve it. Code Mode has no timers or sleep, so don't wait or poll inside a program.",
          stuckNode,
        ),
      ),
      ...(ctx.logs.length > 0 ? { logs: [...ctx.logs] } : {}),
      toolCalls: [],
    }
  }
}

const WARMUP_SCRIPT = `
function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2) }
let sum = 0
for (let i = 0; i < 400; i++) sum = (sum + i * 3) % 10007
const closures = []
for (let i = 0; i < 16; i++) {
  let s = "v" + i
  let o = { x: i, y: s }
  closures.push(() => o.x + s.length)
}
for (const fn of closures) sum += fn()
const arr = Array.from({ length: 64 }, (_, i) => (i * 17) % 64)
const mapped = arr.map((x) => x * 2).filter((x) => x % 3 !== 0)
sum += mapped.reduce((a, b) => a + b, 0)
const sorted = mapped.slice(0, 32).sort((a, b) => a - b)
sum += sorted.length + fib(8)
outer: for (let i = 0; i < 3; i++) {
  try {
    for (const x of [1, 2, 3]) {
      try {
        if (x === 2) continue
        if (i === 1 && x === 3) break outer
        sum += x
      } finally { sum += 1 }
    }
  } catch (e) { sum -= 1 } finally { sum += 2 }
}
const { a = 1, b: [c = 2, ...rest] = [3, 4, 5] } = { b: [10, 20, 30] }
return sum + a + c + rest.length
`

let warmed = false

/**
 * Startup training program (J3): exercises the VM dispatch loop with diverse types
 * (numbers, strings, objects, arrays, closures, cells, try/catch/finally, iteration, destructuring)
 * so JSC's DFG/FTL tiers up `Vm.prototype.exec` with polymorphic value profiles.
 */
export const warmupVm = (rounds = 8): void => {
  if (warmed) return
  warmed = true
  for (let i = 0; i < rounds; i++) {
    runProgram(WARMUP_SCRIPT)
  }
}

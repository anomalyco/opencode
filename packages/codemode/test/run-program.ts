import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Program } from "acorn"
import type { DataValue, Diagnostic, Result } from "../src/codemode.js"
import { normalizeError } from "../src/runtime/errors.js"
import { parseProgram } from "../src/runtime/execute.js"
import { createBuiltins } from "../src/runtime/intrinsics.js"
import { Interpreter } from "../src/runtime/interpreter.js"
import { PendingThrow } from "../src/runtime/model.js"
import type { Value } from "../src/runtime/objects.js"
import { Interruption } from "../src/runtime/signals.js"
import type { Source } from "../src/runtime/source.js"
import type { ToolRuntime } from "../src/tool-runtime.js"
import type { Snapshot } from "../src/snapshot/snapshot.js"

/** A quoted `file:` URL for a module relative to `test`, to import from a script run with `bun -e` on any platform. */
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
):
  | { readonly ok: true; readonly program: Program; readonly source: Source }
  | { readonly ok: false; readonly error: Diagnostic } => {
  if (code.trim().length === 0) {
    return { ok: false, error: { kind: "ParseError", message: "Code cannot be empty." } }
  }
  try {
    return parseProgram(code)
  } catch (error) {
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

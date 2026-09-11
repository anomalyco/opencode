// Runs one vendored test262 file verbatim. The harness (assert, Test262Error, compareArray, $DONE,
// $DONOTEVALUATE) is host-provided because programs cannot attach properties to functions, which
// test262's own assert.js relies on.
import path from "node:path"
import { Cause, Effect } from "effect"
import { caughtErrorValue } from "../../src/interpreter/errors.js"
import { executeProgram } from "../../src/interpreter/execute.js"
import type { Host } from "../../src/interpreter/globals.js"
import { HostFunction } from "../../src/interpreter/host.js"
import { CodeModeFunction, ProgramThrow } from "../../src/interpreter/model.js"
import { createErrorValue, errorBrandName } from "../../src/stdlib/value.js"
import { ToolRuntime } from "../../src/tool-runtime.js"

export const root = import.meta.dir

/** Files that fail on a known gap, mapped to the gap; see skipped.txt. */
export const skipped = new Map(
  (await Bun.file(path.join(root, "skipped.txt")).text())
    .split("\n")
    .filter((line) => line.includes("#"))
    .map((line) => [line.slice(0, line.indexOf("#")).trim(), line.slice(line.indexOf("#") + 1).trim()]),
)

export type Outcome = { readonly status: "pass" } | { readonly status: "fail"; readonly reason: string }

type Frontmatter = {
  flags?: Array<string>
  negative?: { phase: "parse" | "resolution" | "runtime"; type: string }
}

const limits = { timeoutMs: 5000, maxToolCalls: undefined, maxOutputBytes: undefined }
const prepared = ToolRuntime.prepare<never>({})

export const run = async (file: string): Promise<Outcome> => {
  const source = await Bun.file(path.join(root, file)).text()
  const start = source.indexOf("/*---")
  const meta = Bun.YAML.parse(source.slice(start + 5, source.indexOf("---*/", start))) as Frontmatter
  let done: { error: unknown } | undefined
  // Sloppy-only tests are never vendored, so every file runs as the strict half of test262's two-mode run.
  // A host drains the job queue after an async test's script ends; the program end interrupts un-awaited
  // work instead, so drain explicitly.
  const drain = meta.flags?.includes("async") ? "\nfor (let i = 0; i < 100; i++) await null" : ""
  const result = await Effect.runPromise(
    executeProgram(`"use strict";\n${source}${drain}`, prepared, limits, {}, (host) =>
      harness(host, (error) => {
        done ??= { error }
      }),
    ),
  )
  if (meta.negative !== undefined) {
    // Runtime negatives only check that execution failed: diagnostics do not carry the error name.
    if (result.ok) return { status: "fail", reason: `expected ${meta.negative.type} but completed` }
    if (meta.negative.phase === "runtime" || result.error.kind === "ParseError") return { status: "pass" }
    return {
      status: "fail",
      reason: `expected ${meta.negative.type} but got ${result.error.kind}: ${result.error.message}`,
    }
  }
  if (!result.ok) return { status: "fail", reason: `${result.error.kind}: ${result.error.message}` }
  if (!meta.flags?.includes("async")) return { status: "pass" }
  if (done === undefined) return { status: "fail", reason: "$DONE was never called" }
  if (done.error !== undefined) return { status: "fail", reason: `$DONE: ${show(done.error)}` }
  return { status: "pass" }
}

const harness = <R>(host: Host<R>, onDone: (error: unknown) => void): ReadonlyArray<readonly [string, unknown]> => {
  const fail = (message: string) => Effect.fail(new ProgramThrow(createErrorValue("Test262Error", message)))
  const prefix = (message: unknown) => (message === undefined ? "" : `${String(message)} `)
  const compare = (a: unknown, b: unknown) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const test262Error = new HostFunction<R>({
    name: "Test262Error",
    call: (args) => Effect.succeed(createErrorValue("Test262Error", args[0] === undefined ? "" : String(args[0]))),
    construct: (args) => Effect.succeed(createErrorValue("Test262Error", args[0] === undefined ? "" : String(args[0]))),
    instanceOf: (value) => errorBrandName(value) === "Test262Error",
    members: { thrower: new HostFunction<R>({ name: "Test262Error.thrower", call: (args) => fail(String(args[0])) }) },
  })
  const compareArray = new HostFunction<R>({
    name: "compareArray",
    call: (args) => Effect.succeed(compare(args[0], args[1])),
    members: {
      format: new HostFunction<R>({ name: "compareArray.format", call: (args) => Effect.succeed(show(args[0])) }),
    },
  })
  const assert = new HostFunction<R>({
    name: "assert",
    call: (args) =>
      args[0] === true
        ? Effect.void
        : fail(args[1] === undefined ? `Expected true but got ${show(args[0])}` : String(args[1])),
    members: {
      sameValue: new HostFunction<R>({
        name: "assert.sameValue",
        call: (args) =>
          Object.is(args[0], args[1])
            ? Effect.void
            : fail(`${prefix(args[2])}Expected SameValue(«${show(args[0])}», «${show(args[1])}») to be true`),
      }),
      notSameValue: new HostFunction<R>({
        name: "assert.notSameValue",
        call: (args) =>
          Object.is(args[0], args[1])
            ? fail(`${prefix(args[2])}Expected SameValue(«${show(args[0])}», «${show(args[1])}») to be false`)
            : Effect.void,
      }),
      compareArray: new HostFunction<R>({
        name: "assert.compareArray",
        call: (args) =>
          compare(args[0], args[1])
            ? Effect.void
            : fail(
                `Actual ${show(args[0])} and expected ${show(args[1])} should have the same contents. ${prefix(args[2])}`,
              ),
      }),
      throws: new HostFunction<R>({
        name: "assert.throws",
        call: (args, node) => {
          const expected = args[0] instanceof HostFunction ? args[0].name : show(args[0])
          return host.runner.invokeCallable(args[1], [], node).pipe(
            Effect.matchCauseEffect({
              onFailure: (cause) => {
                if (cause.reasons.some(Cause.isInterruptReason)) return Effect.failCause(cause)
                const thrown = caughtErrorValue(Cause.squash(cause))
                if (thrown === null || typeof thrown !== "object") {
                  return fail(`${prefix(args[2])}Thrown value was not an object!`)
                }
                const actual = errorBrandName(thrown)
                if (actual === expected) return Effect.void
                return fail(`${prefix(args[2])}Expected a ${expected} but got a ${actual ?? "non-error object"}`)
              },
              onSuccess: () =>
                fail(`${prefix(args[2])}Expected a ${expected} to be thrown but no exception was thrown at all`),
            }),
          )
        },
      }),
    },
  })
  return [
    ["assert", assert],
    ["compareArray", compareArray],
    ["Test262Error", test262Error],
    ["$DONE", new HostFunction<R>({ name: "$DONE", call: (args) => Effect.sync(() => onDone(args[0])) })],
    [
      "$DONOTEVALUATE",
      new HostFunction<R>({
        name: "$DONOTEVALUATE",
        call: () => Effect.fail(new ProgramThrow("Test262: This statement should not be evaluated.")),
      }),
    ],
  ]
}

const show = (value: unknown): string => {
  if (typeof value === "string") return JSON.stringify(value)
  if (Object.is(value, -0)) return "-0"
  if (Array.isArray(value)) return `[${value.map(show).join(", ")}]`
  if (value instanceof HostFunction) return value.name
  if (value instanceof CodeModeFunction) return "program function"
  if (value === null || typeof value !== "object") return String(value)
  const message = (value as { message?: unknown }).message
  return typeof message === "string" ? `${errorBrandName(value) ?? "object"}: ${message}` : "object"
}

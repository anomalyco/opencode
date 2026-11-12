#!/usr/bin/env bun

// Per-run setup cost: making a runtime, and running a trivial program end to end, in microseconds.
// Usage: bun run script/setup.ts [--iterations N]

import { Effect } from "effect"
import { CodeMode } from "../src/index.js"
import { Interpreter } from "../src/vm/runtime/interpreter.js"
import { createBuiltins } from "../src/vm/runtime/intrinsics.js"
import { ToolRuntime } from "../src/tool-runtime.js"

const index = process.argv.indexOf("--iterations")
const iterations = index === -1 ? 2000 : Number(process.argv[index + 1])

const runtime = CodeMode.make({ tools: {} })
const prepared = ToolRuntime.prepare({})

const measure = async (name: string, work: () => unknown) => {
  for (let at = 0; at < 200; at++) await work()
  const times: Array<number> = []
  for (let at = 0; at < iterations; at++) {
    const start = performance.now()
    await work()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  const micros = (ms: number) => `${(ms * 1000).toFixed(0).padStart(5)} µs`
  console.log(
    `${name.padEnd(24)} median ${micros(times[times.length >> 1]!)}  p10 ${micros(times[Math.floor(times.length / 10)]!)}`,
  )
}

await measure(
  "runtime",
  () => new Interpreter({ tools: ToolRuntime.make(prepared, undefined, {}), builtins: createBuiltins() }),
)
await measure("trivial program", () => Effect.runPromise(runtime.execute("return 1")))

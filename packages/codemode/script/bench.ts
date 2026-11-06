#!/usr/bin/env bun

// Interpreter benchmarks: median and fastest wall-clock milliseconds per program over several runs.
// Usage: bun run script/bench.ts [--engine vm|legacy] [--iterations N] [--filter name] [--mixed] [--jsc]

import { numberOfDFGCompiles, reoptimizationRetryCount } from "bun:jsc"
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"
import { Vm } from "../src/vm/vm.js"

const cases: ReadonlyArray<readonly [name: string, code: string]> = [
  [
    "numeric loop",
    `let sum = 0
for (let i = 0; i < 300000; i++) sum = (sum + i * 3) % 1000003
return sum`,
  ],
  [
    "closure recursion (fib 22)",
    `const fib = (n) => (n < 2 ? n : fib(n - 1) + fib(n - 2))
return fib(22)`,
  ],
  [
    "array callbacks (50k)",
    `const items = Array.from({ length: 50000 }, (_, i) => (i * 7919) % 50000)
const mapped = items.map((x) => x * 2).filter((x) => x % 3 !== 0)
const total = mapped.reduce((a, b) => a + b, 0)
const sorted = mapped.slice(0, 20000).sort((a, b) => a - b)
return [total, sorted[0], sorted[sorted.length - 1]]`,
  ],
  [
    "promise fan-out (5k)",
    `const work = async (i) => { await null; return i * 2 }
const results = await Promise.all(Array.from({ length: 5000 }, (_, i) => work(i)))
return results.length`,
  ],
  [
    "tool fan-out (1k)",
    `const results = await Promise.all(Array.from({ length: 1000 }, (_, i) => tools.echo({ id: i })))
return results.length`,
  ],
  [
    "JSON round-trip",
    `const make = (depth) => depth === 0 ? { a: 1, b: "two", c: [1, 2, 3], d: null } : { left: make(depth - 1), right: make(depth - 1), list: [depth, String(depth)] }
let size = 0
for (let i = 0; i < 20; i++) size += JSON.stringify(JSON.parse(JSON.stringify(make(9)))).length
return size`,
  ],
  [
    "generator iteration",
    `function* range(n) { for (let i = 0; i < n; i++) yield i }
let sum = 0
for (const x of range(50000)) sum += x
return sum`,
  ],
  [
    "string building",
    `let out = ""
for (let i = 0; i < 50000; i++) out += String.fromCharCode(97 + (i % 26))
const parts = []
for (let i = 0; i < 20000; i++) parts.push(\`item-\${i}\`)
return out.length + parts.join(",").length`,
  ],
  [
    "Map/Set ops",
    `const map = new Map()
const set = new Set()
for (let i = 0; i < 30000; i++) { map.set("k" + (i % 5000), i); set.add(i % 7000) }
let sum = 0
for (const [k, v] of map) sum += v
for (const v of set) sum += v
for (let i = 0; i < 5000; i++) { map.delete("k" + i); set.delete(i) }
return sum + map.size + set.size`,
  ],
]

const argument = (flag: string) => {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}
const iterations = Number(argument("--iterations") ?? 7)
const filter = argument("--filter")
const engine = (argument("--engine") as "legacy" | "vm" | undefined) ?? "vm"
const mixed = process.argv.includes("--mixed")
const jsc = mixed || process.argv.includes("--jsc")
const exec = Vm.prototype["exec"]

const runtime = CodeMode.make({
  engine,
  tools: {
    echo: Tool.make({
      description: "Echo an id",
      input: Schema.Struct({ id: Schema.Number }),
      output: Schema.Number,
      execute: ({ id }) => Effect.succeed(id),
    }),
  },
})

const median = (values: Array<number>) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

const run = (code: string) => runtime.execute(code)

const selected = cases.filter(([name]) => filter === undefined || name.includes(filter))

const formatRow = (name: string, times: Array<number>) => {
  const base = `${name.padEnd(28)} ${median(times).toFixed(1).padStart(8)} ms  (min ${Math.min(...times).toFixed(1)} ms)`
  if (!jsc) return base
  return `${base}  [dfg=${numberOfDFGCompiles(exec)} retries=${reoptimizationRetryCount(exec)}]`
}

if (mixed) {
  // Pollute profiles in reverse order first, then interleave cases with a stride across rounds.
  for (let i = selected.length - 1; i >= 0; i--) {
    const [name, code] = selected[i]!
    const warm = await Effect.runPromise(run(code))
    if (warm.ok !== true) throw new Error(`${name} failed: ${JSON.stringify(warm)}`)
  }
  const recorded = selected.map((): Array<number> => [])
  for (let round = 0; round < iterations; round++) {
    for (let step = 0; step < selected.length; step++) {
      const idx = (step * 5 + round * 3) % selected.length
      const [, code] = selected[idx]!
      const start = performance.now()
      await Effect.runPromise(run(code))
      recorded[idx]!.push(performance.now() - start)
    }
  }
  for (let i = 0; i < selected.length; i++) {
    console.log(formatRow(selected[i]![0], recorded[i]!))
  }
} else {
  for (const [name, code] of selected) {
    // One warm-up run, which also checks the program succeeds.
    const warm = await Effect.runPromise(run(code))
    if (warm.ok !== true) throw new Error(`${name} failed: ${JSON.stringify(warm)}`)
    const times = Array.from({ length: iterations }, () => 0)
    for (const index of times.keys()) {
      const start = performance.now()
      await Effect.runPromise(run(code))
      times[index] = performance.now() - start
    }
    console.log(formatRow(name, times))
  }
}

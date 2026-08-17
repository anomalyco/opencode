import fs from "fs/promises"
import os from "os"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/util/cross-spawn-spawner"
import { LayerNodePlatform } from "@opencode-ai/util/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Effect } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { lookup } from "mime-types"
import { Environment } from "../src/environment/index"
import type { Files } from "../src/environment/index"
import { Mime } from "../src/mime"
import { AbsolutePath } from "../src/schema"
import { ReadToolFileSystem } from "../src/tool/read-filesystem"

const CHUNK_SIZE = 256 * 1024
const workerIndex = process.argv.indexOf("--worker")

if (workerIndex !== -1) {
  const algorithm = process.argv[workerIndex + 1]
  const file = process.argv[workerIndex + 2]
  const offset = Number(process.argv[workerIndex + 3])
  const limit = Number(process.argv[workerIndex + 4])
  const expected = process.argv[workerIndex + 5]
  const startCpu = process.cpuUsage()
  const start = performance.now()

  const content = await Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const environment = Environment.makeFiles(Environment.makeLocalDriver(spawner))
    if (algorithm === "baseline") return yield* baseline(environment, file, offset, limit)
    const result = yield* ReadToolFileSystem.read(environment, AbsolutePath.make(file), path.basename(file), {
      offset,
      limit,
    })
    if (result.type !== "text-page") return yield* Effect.die("candidate did not return a text page")
    return result.content
  }).pipe(
    Effect.scoped,
    Effect.provide(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, LayerNodePlatform.filesystem]))),
    Effect.runPromise,
  )

  const wallMs = performance.now() - start
  const cpu = process.cpuUsage(startCpu)
  if (content !== expected) throw new Error(`${algorithm} returned the wrong page`)
  console.log(JSON.stringify({ wallMs, cpuMs: (cpu.user + cpu.system) / 1_000 }))
  process.exit(0)
}

if (process.platform !== "linux") {
  console.error("benchmark:read-scenarios currently requires Linux /usr/bin/time for peak RSS")
  process.exit(1)
}

const args = process.argv.slice(2)
const largeIndex = args.indexOf("--large-iterations")
const smallIndex = args.indexOf("--small-iterations")
const largeIterations = largeIndex === -1 ? 3 : Number(args[largeIndex + 1])
const smallIterations = smallIndex === -1 ? 10 : Number(args[smallIndex + 1])

if (![largeIterations, smallIterations].every((value) => Number.isInteger(value) && value > 0)) {
  console.error("iteration counts must be positive integers")
  process.exit(1)
}

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-read-scenarios-"))
const scenarios = [
  await fixture({ directory, name: "large-log", lines: 2_000_250, offset: 2_000_000, limit: 125, code: false }),
  await fixture({ directory, name: "small-code", lines: 1_000, offset: 500, limit: 125, code: true }),
]
const iterations = new Map([
  ["large-log", largeIterations],
  ["small-code", smallIterations],
])

type Sample = { readonly wallMs: number; readonly cpuMs: number; readonly peakRssKb: number }
const results = new Map<string, Sample[]>()

for (const scenario of scenarios) {
  for (let iteration = 0; iteration < (iterations.get(scenario.name) ?? 1); iteration++) {
    for (const algorithm of iteration % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"]) {
      const metrics = path.join(directory, `${scenario.name}-${algorithm}-${iteration}.time`)
      const child = Bun.spawn({
        cmd: [
          "/usr/bin/time",
          "-v",
          "-o",
          metrics,
          process.execPath,
          import.meta.path,
          "--worker",
          algorithm,
          scenario.file,
          String(scenario.offset),
          String(scenario.limit),
          scenario.expected,
        ],
        stdout: "pipe",
        stderr: "inherit",
      })
      const stdout = await new Response(child.stdout).text()
      const exit = await child.exited
      if (exit !== 0) throw new Error(`${scenario.name} ${algorithm} worker exited ${exit}`)
      const sample = JSON.parse(stdout) as Omit<Sample, "peakRssKb">
      const report = await fs.readFile(metrics, "utf8")
      const peak = report.match(/Maximum resident set size \(kbytes\): (\d+)/)?.[1]
      if (!peak) throw new Error("could not read peak RSS from /usr/bin/time")
      const key = `${scenario.name}:${algorithm}`
      results.set(key, [...(results.get(key) ?? []), { ...sample, peakRssKb: Number(peak) }])
    }
  }
}

console.log("| Scenario | Implementation | Wall mean | CPU mean | CPU utilization | Peak RSS |")
console.log("|---|---|---:|---:|---:|---:|")
for (const scenario of scenarios) {
  for (const algorithm of ["baseline", "candidate"]) {
    const samples = results.get(`${scenario.name}:${algorithm}`) ?? []
    const wall = mean(samples.map((sample) => sample.wallMs))
    const cpu = mean(samples.map((sample) => sample.cpuMs))
    const peak = Math.max(...samples.map((sample) => sample.peakRssKb))
    console.log(
      `| ${scenario.name} | ${algorithm} | ${formatDuration(wall)} | ${formatDuration(cpu)} | ${((cpu / wall) * 100).toFixed(1)}% | ${(peak / 1024).toFixed(1)} MiB |`,
    )
  }
}

await fs.rm(directory, { recursive: true, force: true })

function baseline(files: Files, file: string, offset: number, limit: number) {
  return Effect.fn("ReadTool.read")(function* () {
    const first = yield* files.read(AbsolutePath.make(file), { offset: 0, length: CHUNK_SIZE })
    Mime.detect(first.bytes)
    const chunks = [first.bytes]
    while (true) {
      const bytes = Buffer.concat(chunks)
      const eof = bytes.length >= first.info.size
      const split = new TextDecoder().decode(bytes).split("\n")
      const complete = eof ? (split.at(-1) === "" ? split.slice(0, -1) : split) : split.slice(0, -1)
      const available = complete.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
      const entries = available.slice(offset - 1, offset - 1 + limit)
      if (entries.length === limit || eof) {
        const consumedLines = Math.min(offset - 1 + entries.length, available.length)
        let found = 0
        let consumed = bytes.length
        for (const [index, byte] of bytes.entries()) {
          if (byte !== 10) continue
          found++
          if (found !== consumedLines) continue
          consumed = index + 1
          break
        }
        bytes.subarray(0, consumed).includes(0)
        lookup(file)
        return entries.join("\n")
      }
      const next = yield* files.read(AbsolutePath.make(file), { offset: bytes.length, length: CHUNK_SIZE })
      chunks.push(next.bytes)
    }
  })()
}

async function fixture(input: {
  readonly directory: string
  readonly name: string
  readonly lines: number
  readonly offset: number
  readonly limit: number
  readonly code: boolean
}) {
  const file = path.join(input.directory, `${input.name}.txt`)
  const output = await fs.open(file, "w")
  const line = (number: number) =>
    input.code
      ? `export const value${String(number).padStart(4, "0")} = "Lorem ipsum dolor sit amet, consectetur adipiscing elit."`
      : `${String(number).padStart(7, "0")} Lorem ipsum dolor sit amet, consectetur adipiscing elit.`

  for (let start = 1; start <= input.lines; start += 10_000) {
    const count = Math.min(10_000, input.lines - start + 1)
    await output.write(Array.from({ length: count }, (_, index) => `${line(start + index)}\n`).join(""))
  }
  await output.close()
  return {
    name: input.name,
    file,
    offset: input.offset,
    limit: input.limit,
    expected: Array.from({ length: input.limit }, (_, index) => line(input.offset + index)).join("\n"),
  }
}

function mean(values: ReadonlyArray<number>) {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function formatDuration(milliseconds: number) {
  return milliseconds >= 1_000 ? `${(milliseconds / 1_000).toFixed(3)} s` : `${milliseconds.toFixed(2)} ms`
}

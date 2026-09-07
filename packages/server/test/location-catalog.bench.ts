// Not a test: `bun run test/location-catalog.bench.ts` from packages/server.
// Measures one `location.sync` against a real server three ways.
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { startServer } from "./fixture/server"

const lists = [
  "/api/location",
  "/api/agent",
  "/api/command",
  "/api/integration",
  "/api/mcp",
  "/api/mcp/resource",
  "/api/model",
  "/api/provider",
  "/api/reference",
  "/api/skill",
  "/api/shell",
  "/api/form/request",
]

const program = Effect.gen(function* () {
  // Pass a project directory to measure populated catalogs; defaults to an empty temporary project.
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-location-catalog-bench-")))
  yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "opencode.json"), JSON.stringify({})))
  const directory = process.argv[2] ?? tmp.path
  const server = yield* startServer(directory)
  const read = async (pathname: string) => {
    const url = new URL(pathname, server.base)
    url.searchParams.set("location[directory]", directory)
    const response = await fetch(url, { headers: server.headers })
    await response.arrayBuffer()
    return response.status
  }
  // Let the location boot and its catalogs settle before timing anything.
  yield* Effect.promise(() => read("/api/location/catalog"))
  yield* Effect.sleep("2 seconds")

  const queued = async (limit: number) => {
    const pending = [...lists]
    const worker = async () => {
      while (pending.length) await read(pending.shift()!)
    }
    await Promise.all(Array.from({ length: Math.min(limit, lists.length) }, worker))
  }
  const strategies = {
    "Desktop today: 12 requests, 4 at a time": () => queued(4),
    "TUI today: 12 requests, all at once": () => queued(lists.length),
    "Catalog: 1 request": () => read("/api/location/catalog"),
  }
  const results = yield* Effect.promise(async () => {
    const timings: Record<string, number[]> = {}
    for (let round = 0; round < 30; round++) {
      for (const [name, run] of Object.entries(strategies)) {
        const start = performance.now()
        await run()
        timings[name] = [...(timings[name] ?? []), performance.now() - start]
      }
    }
    return timings
  })
  const pct = (values: number[], p: number) => values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * p)]!
  console.log(`| Strategy | p50 | p90 | requests |`)
  console.log(`|---|---|---|---|`)
  for (const [name, values] of Object.entries(results)) {
    const requests = name.startsWith("Catalog") ? 1 : lists.length
    console.log(`| ${name} | ${pct(values, 0.5).toFixed(1)} ms | ${pct(values, 0.9).toFixed(1)} ms | ${requests} |`)
  }
})

await Effect.runPromise(Effect.scoped(program))

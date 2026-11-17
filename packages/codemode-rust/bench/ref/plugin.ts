// Plugin-event benchmark, reference side: the conformance reducer handling a `git.status` command event.
// Counterpart of `psychoscript-bench --plugin`. Prints one JSON line per source: median, min and mean µs per execute.
// Usage: bun bench/ref/plugin.ts [--runs N] <source>...
import { resolve } from "node:path"

// The reference CodeMode package: CODEMODE_REF, or by default ../codemode relative to this workspace.

const pkg =
  process.env.CODEMODE_REF === undefined
    ? resolve(import.meta.dir, "../../../codemode")
    : resolve(process.env.CODEMODE_REF)
const { Effect, Schema } = await import(Bun.resolveSync("effect", resolve(pkg, "src")))
const { CodeMode, Tool } = await import(resolve(pkg, "src/index.ts"))

// The tool of conformance/generate.ts.
const runtime = CodeMode.make({
  tools: {
    git: {
      status: Tool.make({
        description: "Working tree status",
        input: Schema.Struct({}),
        output: Schema.Struct({ branch: Schema.String, dirty: Schema.Boolean }),
        execute: () => Effect.succeed({ branch: "main", dirty: true }),
      }),
    },
  },
})

const bindings = { event: { type: "command", name: "git.status" }, state: { runs: 2 } }
const expected = JSON.stringify({ state: { runs: 3 }, slots: { statusbar: { text: "main *" } } })
const flag = process.argv.indexOf("--runs")
const runs = flag === -1 ? 2000 : Number(process.argv[flag + 1])
const sources = process.argv.slice(2).filter((arg, i, all) => arg !== "--runs" && all[i - 1] !== "--runs")

for (const source of sources) {
  const code = await Bun.file(source).text()
  const execute = () => Effect.runPromise(runtime.execute(code, bindings))
  // Warm-up, as many runs as are measured; the first also checks the result.
  const warm = await execute()
  if (warm.ok !== true || JSON.stringify(warm.value) !== expected)
    throw new Error(`${source}: unexpected outcome ${JSON.stringify(warm)}`)
  for (let i = 1; i < runs; i++) await execute()
  const times: Array<number> = []
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    await execute()
    times.push((performance.now() - start) * 1000)
  }
  const sorted = [...times].sort((a, b) => a - b)
  const mean = times.reduce((a, b) => a + b, 0) / runs
  console.log(
    JSON.stringify({
      source,
      bytes: Buffer.byteLength(code),
      median_us: sorted[Math.floor(runs / 2)],
      min_us: sorted[0],
      mean_us: mean,
    }),
  )
}

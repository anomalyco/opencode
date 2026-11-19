// Plugin-event benchmark, reference side: the conformance reducer handling a `git.status` command event.
// Counterpart of `psychoscript-bench --plugin`. Prints one JSON line per source: median, min and mean µs per execute,
// from the source and from the program `runtime.compile` made of it once (`compiled_*`).
// Usage: bun bench/ref/plugin.ts [--runs N] <source>...
import { reference, toolsGlobal } from "../../conformance/reference.ts"

// The reference's language layer: the CodeMode package from CODEMODE_REF, or by default ../codemode relative to this
// workspace. The programs reach one host global, `tools`, the namespace of conformance/reference.ts (`tools.echo`,
// `tools.git.status`, ... all async, as Code Mode tools were).
const ref = await reference(process.env.CODEMODE_REF)
const Effect = ref.Effect
const tools = toolsGlobal(ref)
const runtime = ref.Language.Runtime.make({ globals: () => ({ tools }) })

const bindings = { event: { type: "command", name: "git.status" }, state: { runs: 2 } }
const expected = JSON.stringify({ state: { runs: 3 }, slots: { statusbar: { text: "main *" } } })
const flag = process.argv.indexOf("--runs")
const runs = flag === -1 ? 2000 : Number(process.argv[flag + 1])
const sources = process.argv.slice(2).filter((arg, i, all) => arg !== "--runs" && all[i - 1] !== "--runs")

// Warm-up, as many runs as are measured, the first checking the result; then the median, min and mean µs of the runs.
const timed = async (source: string, execute: () => Promise<{ ok: boolean; value?: unknown }>) => {
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
  return { median: sorted[Math.floor(runs / 2)], min: sorted[0], mean: times.reduce((a, b) => a + b, 0) / runs }
}

for (const source of sources) {
  const code = await Bun.file(source).text()
  const compiled = runtime.compile(code)
  if (!compiled.ok) throw new Error(`${source}: ${compiled.error.message}`)
  const fromSource = await timed(source, () => Effect.runPromise(runtime.execute(code, { bindings })))
  const fromCompiled = await timed(source, () => Effect.runPromise(runtime.execute(compiled.compiled, { bindings })))
  console.log(
    JSON.stringify({
      source,
      bytes: Buffer.byteLength(code),
      median_us: fromSource.median,
      min_us: fromSource.min,
      mean_us: fromSource.mean,
      compiled_median_us: fromCompiled.median,
      compiled_min_us: fromCompiled.min,
      compiled_mean_us: fromCompiled.mean,
    }),
  )
}

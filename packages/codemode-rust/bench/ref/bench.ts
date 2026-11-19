// The nine bench programs through the reference's language layer, the counterpart of `psychoscript-bench --json`:
// one warm-up run that also checks the program succeeds, then N timed runs. Prints one JSON line per program: its
// value and the median and min ms.
// Usage: bun bench/ref/bench.ts [--iterations N] <slug>...
import { resolve } from "node:path"
import { reference, toolsGlobal } from "../../conformance/reference.ts"

// The reference's language layer: the CodeMode package from CODEMODE_REF, or by default ../codemode relative to this
// workspace. The programs reach one host global, `tools`, the namespace of conformance/reference.ts (`tools.echo`,
// `tools.git.status`, ... all async).
const ref = await reference(process.env.CODEMODE_REF)
const Effect = ref.Effect
const tools = toolsGlobal(ref)
const runtime = ref.Language.Runtime.make({ globals: () => ({ tools }) })

const flag = process.argv.indexOf("--iterations")
const iterations = flag === -1 ? 11 : Number(process.argv[flag + 1])
const slugs = process.argv.slice(2).filter((arg, i, all) => arg !== "--iterations" && all[i - 1] !== "--iterations")

for (const slug of slugs) {
  const code = await Bun.file(resolve(import.meta.dir, `../../conformance/cases/bench-${slug}.js`)).text()
  const warm = await Effect.runPromise(runtime.execute(code))
  if (warm.ok !== true) throw new Error(`${slug} failed: ${JSON.stringify(warm)}`)
  const times: Array<number> = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await Effect.runPromise(runtime.execute(code))
    times.push(performance.now() - start)
  }
  const sorted = [...times].sort((a, b) => a - b)
  console.log(
    JSON.stringify({ slug, value: warm.value, median_ms: sorted[Math.floor(sorted.length / 2)], min_ms: sorted[0] }),
  )
}

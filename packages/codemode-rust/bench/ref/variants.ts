// Runs each bench program and its perturbed variant through the reference, with the `tools` host global.
// Checks the variant returns what the original does, then prints one JSON line per program: median and min ms.
// Usage: bun bench/ref/variants.ts [--iterations N] <slug>...
import { resolve } from "node:path"
import { reference, toolsGlobal } from "../../conformance/reference.ts"

// The reference's language layer: the CodeMode package from CODEMODE_REF, or by default ../codemode relative to this
// workspace. The programs reach one host global, `tools`, the namespace of conformance/reference.ts (`tools.echo`,
// `tools.git.status`, ... all async, as Code Mode tools were).
const ref = await reference(process.env.CODEMODE_REF)
const Effect = ref.Effect
const tools = toolsGlobal(ref)
const runtime = ref.Language.Runtime.make({ globals: () => ({ tools }) })

const flag = process.argv.indexOf("--iterations")
const iterations = flag === -1 ? 11 : Number(process.argv[flag + 1])
const slugs = process.argv.slice(2).filter((arg, i, all) => arg !== "--iterations" && all[i - 1] !== "--iterations")

const measure = async (path: string) => {
  const code = await Bun.file(path).text()
  // One warm-up run, which also checks the program succeeds.
  const warm = await Effect.runPromise(runtime.execute(code))
  if (warm.ok !== true) throw new Error(`${path} failed: ${JSON.stringify(warm)}`)
  const times: Array<number> = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await Effect.runPromise(runtime.execute(code))
    times.push(performance.now() - start)
  }
  const sorted = [...times].sort((a, b) => a - b)
  return { value: warm.value, median_ms: sorted[Math.floor(sorted.length / 2)], min_ms: sorted[0] }
}

for (const slug of slugs) {
  const original = await measure(resolve(import.meta.dir, `../../conformance/cases/bench-${slug}.js`))
  const variant = await measure(resolve(import.meta.dir, `../variants/bench-${slug}.js`))
  if (JSON.stringify(original.value) !== JSON.stringify(variant.value))
    throw new Error(
      `${slug}: the variant returns ${JSON.stringify(variant.value)}, not ${JSON.stringify(original.value)}`,
    )
  console.log(JSON.stringify({ slug, original, variant }))
}

// Runs one bench case once through the reference, for one-shot measurements such as peak RSS.
// Usage: bun bench/ref/run-case.ts <slug>
import { resolve } from "node:path"
import { reference, toolsGlobal } from "../../conformance/reference.ts"

// The reference's language layer: the CodeMode package from CODEMODE_REF, or by default ../codemode relative to this
// workspace. The programs reach one host global, `tools`, the namespace of conformance/reference.ts (`tools.echo`,
// `tools.git.status`, ... all async, as Code Mode tools were).
const ref = await reference(process.env.CODEMODE_REF)
const Effect = ref.Effect
const tools = toolsGlobal(ref)
const runtime = ref.Language.Runtime.make({ globals: () => ({ tools }) })

const code = await Bun.file(resolve(import.meta.dir, `../../conformance/cases/bench-${process.argv[2]}.js`)).text()
const result = await Effect.runPromise(runtime.execute(code))
if (!result.ok) throw new Error(`${process.argv[2]} failed: ${JSON.stringify(result)}`)

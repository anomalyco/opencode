// Reference counterpart of bench/examples/embed.rs. Usage: bun bench/ref/embed.ts [code]
import { reference, toolsGlobal } from "../../conformance/reference.ts"

// The reference's language layer: the CodeMode package from CODEMODE_REF, or by default ../codemode relative to this
// workspace. The programs reach one host global, `tools`, the namespace of conformance/reference.ts (`tools.echo`,
// `tools.git.status`, ... all async, as Code Mode tools were).
const ref = await reference(process.env.CODEMODE_REF)
const Effect = ref.Effect
const tools = toolsGlobal(ref)
const runtime = ref.Language.Runtime.make({ globals: () => ({ tools }) })

const result = await Effect.runPromise(runtime.execute(process.argv[2] ?? "return 1"))
for (const line of result.logs ?? []) console.error(line)
if (!result.ok) {
  console.error(`${result.error.kind}: ${result.error.message}`)
  process.exit(1)
}
console.log(JSON.stringify(result.value))

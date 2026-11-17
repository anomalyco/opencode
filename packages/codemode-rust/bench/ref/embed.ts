// Reference counterpart of bench/examples/embed.rs. Usage: bun bench/ref/embed.ts [code]
import { resolve } from "node:path"

// The reference CodeMode package: CODEMODE_REF, or by default ../codemode relative to this workspace.

const pkg =
  process.env.CODEMODE_REF === undefined
    ? resolve(import.meta.dir, "../../../codemode")
    : resolve(process.env.CODEMODE_REF)
const { Effect, Schema } = await import(Bun.resolveSync("effect", resolve(pkg, "src")))
const { CodeMode, Tool } = await import(resolve(pkg, "src/index.ts"))

const runtime = CodeMode.make({
  tools: {
    echo: Tool.make({ description: "Echo", input: Schema.Unknown, output: Schema.Unknown, execute: Effect.succeed }),
  },
})
const result = await Effect.runPromise(runtime.execute(process.argv[2] ?? "return 1"))
for (const line of result.logs ?? []) console.error(line)
if (!result.ok) {
  console.error(`${result.error.kind}: ${result.error.message}`)
  process.exit(1)
}
console.log(JSON.stringify(result.value))

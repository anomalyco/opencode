// Runs one bench case once through the reference, for one-shot measurements such as peak RSS.
// Usage: bun bench/ref/run-case.ts <slug>
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
    echo: Tool.make({
      description: "Echo an id",
      input: Schema.Struct({ id: Schema.Number }),
      output: Schema.Number,
      execute: ({ id }: { id: number }) => Effect.succeed(id),
    }),
  },
})
const code = await Bun.file(resolve(import.meta.dir, `../../conformance/cases/bench-${process.argv[2]}.js`)).text()
const result = await Effect.runPromise(runtime.execute(code))
if (!result.ok) throw new Error(`${process.argv[2]} failed: ${JSON.stringify(result)}`)

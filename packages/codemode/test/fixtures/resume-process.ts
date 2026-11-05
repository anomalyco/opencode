// Resumes a saved run in its own process: `bun resume-process.ts <state file> <pending key>`. The durable `slow` tool
// answers `{ value: input.value * 2 }`; the pending call's outcome is given as `{ value: 20 }`.
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../../src/index.js"

const Value = Schema.Struct({ value: Schema.Number })
const slow = Tool.make({
  description: "Doubles",
  input: Value,
  output: Value,
  durable: {
    start: (input) => Effect.succeed(input.value),
    attach: (handle) => Effect.succeed({ value: (handle as number) * 2 }),
    cancel: () => Effect.void,
  },
})
const [file, key] = process.argv.slice(2)
const bytes = new Uint8Array(await Bun.file(file!).arrayBuffer())
const resumed = CodeMode.make({ tools: { slow } }).resume(bytes, { [key!]: { ok: true, value: { value: 20 } } })
console.log(
  JSON.stringify(await Effect.runPromise(Effect.scoped(Effect.flatMap(resumed, (execution) => execution.result)))),
)

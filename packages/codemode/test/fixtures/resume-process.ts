// Resumes a saved run in its own process: `bun resume-process.ts <state file>`. The `slow` tool answers
// `{ value: input.value * 2 }`.
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../../src/index.js"

const Value = Schema.Struct({ value: Schema.Number })
const slow = Tool.make({
  description: "Doubles",
  input: Value,
  output: Value,
  execute: (input) => Effect.succeed({ value: input.value * 2 }),
})
const [file] = process.argv.slice(2)
const bytes = new Uint8Array(await Bun.file(file!).arrayBuffer())
const resumed = CodeMode.make({ tools: { slow } }).resume(bytes)
console.log(JSON.stringify(await Effect.runPromise(resumed.run())))

// Resumes a saved run in its own process: `bun resume-getters-process.ts <state file>`. The globals match
// test/accessors-suspend.test.ts: `slow` answers `n * 2`, `pick` its argument, `keep` nothing; promises in arguments are
// awaited.
import { Effect } from "effect"
import { Host, Runtime } from "../../src/language/index.js"

const runtime = Runtime.make({
  translate: { promises: "await" },
  globals: () => ({
    slow: Host.fn(([n]) => Effect.succeed((n as number) * 2), { type: "async", idempotent: true }),
    pick: Host.fn(([value]) => value),
    keep: Host.fn(() => undefined),
  }),
}) as Runtime.Runtime<never>
const [file] = process.argv.slice(2)
const bytes = new Uint8Array(await Bun.file(file!).arrayBuffer())
console.log(JSON.stringify(await Effect.runPromise(runtime.resume(bytes).run())))

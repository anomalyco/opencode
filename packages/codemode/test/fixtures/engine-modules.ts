// Runs one program on the engine named in argv (default when absent) and prints which `src/vm` modules were loaded.
import path from "node:path"
import { Effect } from "effect"
import { CodeMode } from "../../src/index.js"

const engine = process.argv[2] === "vm" ? "vm" : undefined
const result = await Effect.runPromise(CodeMode.execute({ code: "return [1, 2].map((n) => n * 2)", tools: {}, engine }))
const vm = path.join(import.meta.dir, "../../src/vm") + path.sep
console.log(JSON.stringify({ result, vm: Object.keys(require.cache).filter((key) => key.startsWith(vm)) }))

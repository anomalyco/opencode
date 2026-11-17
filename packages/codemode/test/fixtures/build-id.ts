// Prints this process's snapshot build id, from a runtime made with as few of the package's modules as it takes, so
// the id can be compared across entry points (`bun --preload <module> build-id.ts`).
import { Interpreter } from "../../src/runtime/interpreter.js"
import { createBuiltins } from "../../src/runtime/intrinsics.js"
import { buildId } from "../../src/snapshot.js"
import { ToolRuntime } from "../../src/tool-runtime.js"

new Interpreter({ tools: ToolRuntime.make(ToolRuntime.prepare({}), undefined, {}), builtins: createBuiltins() })
console.log(buildId())

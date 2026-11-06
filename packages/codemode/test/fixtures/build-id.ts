// Prints this process's snapshot build id, from a runtime made with as few of the package's modules as it takes, so
// the id can be compared across entry points (`bun --preload <module> build-id.ts`).
import { Interpreter } from "../../src/vm/runtime/interpreter.js"
import { createBuiltins } from "../../src/vm/runtime/intrinsics.js"
import { buildId } from "../../src/vm/snapshot.js"
import { ToolRuntime } from "../../src/tool-runtime.js"

new Interpreter({ tools: ToolRuntime.make(ToolRuntime.prepare({}), undefined, {}), builtins: createBuiltins() })
console.log(buildId())

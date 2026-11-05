// Prints this process's snapshot build id, from a runtime made with as few of the package's modules as it takes, so
// the id can be compared across entry points (`bun --preload <module> build-id.ts`).
import "../../src/machine/kinds.js"
import { Interpreter } from "../../src/interpreter/interpreter.js"
import { createBuiltins } from "../../src/interpreter/intrinsics.js"
import { buildId } from "../../src/snapshot/snapshot.js"
import { ToolRuntime } from "../../src/tool-runtime.js"

console.log(
  buildId(
    new Interpreter({ tools: ToolRuntime.make(ToolRuntime.prepare({}), undefined, {}), builtins: createBuiltins() }),
  ),
)

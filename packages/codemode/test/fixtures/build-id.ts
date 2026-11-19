// Prints this process's snapshot build id, from a runtime made with as few of the package's modules as it takes, so
// the id can be compared across entry points (`bun --preload <module> build-id.ts`).
import { Interpreter } from "../../src/language/runtime/interpreter.js"
import { createBuiltins } from "../../src/language/runtime/intrinsics.js"
import { buildId } from "../../src/language/snapshot.js"

new Interpreter({ builtins: createBuiltins() })
console.log(buildId())

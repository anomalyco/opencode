// Every module that defines a frame kind, then the seal: once this module has loaded, `kind()` throws, so the kinds a
// saved state names, and the snapshot build id hashes, are the package's own and never depend on what else a process
// imported, or when. The runtime factory (`interpreter/execute.ts`) imports it,
// and a runtime refuses to be made before it has loaded. Nothing it imports may import it back: the seal must run only
// after every kind module has finished loading. Add a module here when it starts defining kinds.
import "../data.js"
import "../interpreter/extensions.js"
import "../interpreter/interpreter.js"
import "../interpreter/promises.js"
import "../stdlib/array.js"
import "./calls.js"
import "./expressions.js"
import "./generators.js"
import "./iteration.js"
import "./patterns.js"
import "./statements.js"
import "./task.js"
import { sealKinds } from "./frame.js"

sealKinds()

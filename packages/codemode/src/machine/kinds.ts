// Every module that defines a frame kind or a consumer, then the seal: once this module has loaded, `kind()` and
// `consumer()` throw, so the kinds a saved state names, and the snapshot build id hashes, are the package's own and
// never depend on what else a process imported, or when. The runtime factory (`interpreter/execute.ts`) imports it,
// and a runtime refuses to be made before it has loaded. Nothing it imports may import it back: the seal must run only
// after every kind module has finished loading. Add a module here when it starts defining kinds.
import "../data.js"
import "../interpreter/errors.js"
import "../interpreter/extensions.js"
import "../interpreter/interpreter.js"
import "../interpreter/promises.js"
import "../stdlib/array.js"
import "../stdlib/bytes.js"
import "../stdlib/collections.js"
import "../stdlib/iterator.js"
import "../stdlib/json.js"
import "../stdlib/math.js"
import "../stdlib/object.js"
import "../stdlib/string.js"
import "../stdlib/url.js"
import "./calls.js"
import "./expressions.js"
import "./generators.js"
import "./helpers.js"
import "./iteration.js"
import "./natives.js"
import "./patterns.js"
import "./statements.js"
import "./task.js"
import { sealKinds } from "./frame.js"

sealKinds()

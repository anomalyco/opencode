// Safari before 17.4 does not provide these runtime APIs; Promise.try arrived in Safari 18.2.
import "core-js/es/map/group-by"
import "core-js/es/promise/with-resolvers"
import "core-js/es/promise/try"
// URL.canParse arrived in Safari 17 and URL.parse in Safari 18. These modules add only the static methods; the
// `core-js/*/url` entry points would also replace the native URL constructor.
import "core-js/modules/web.url.can-parse"
import "core-js/modules/web.url.parse"
import { anySignal } from "./abort-signal"

// Every client call that takes a caller's signal combines it with its own through AbortSignal.any (Safari 17.4).
if (!Object.hasOwn(AbortSignal, "any")) {
  Object.defineProperty(AbortSignal, "any", { value: anySignal, writable: true, configurable: true })
}

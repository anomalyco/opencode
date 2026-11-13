export * as PluginScheduling from "./scheduling.js"

import { Effect } from "effect"

// Setup runs in registration order, but an entire generation must not occupy one
// JavaScript turn. The live Clock's zero-duration sleep yields through Effect's
// native scheduler (not a resolved promise), so HTTP, streaming and other
// locations progress below the operation-count auto-yield threshold.
// Keep the Clock injectable: virtual-clock tests must not wait for wall time.
const turn = Effect.sleep(0)
export const checkpoint = turn.pipe(Effect.withSpan("Plugin.init.eventLoopCheckpoint"))
// The same yield, registered as each plugin scope's first finalizer. Its own
// span name attributes close-path yields in traces and marks the release build.
export const scopeCheckpoint = turn.pipe(Effect.withSpan("Plugin.scopeClose.eventLoopCheckpoint"))

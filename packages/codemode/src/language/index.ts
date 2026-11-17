export * as Language from "./index.js"

// The language layer: the compiler, VM, runtime, standard library, snapshots, and the Effect driver. It knows nothing
// about tools; a host gives programs its functions through `Host` and runs them with `Runtime.make`.
export { Host } from "./host-function.js"
export { Runtime } from "./runtime.js"
export { StreamingResponse } from "./streaming-response.js"
export { fromBytes, SnapshotError, toBytes, type Snapshot, type SnapshotHeader } from "./snapshot/snapshot.js"
export { SuspendError } from "./runtime/execute.js"
export { globalNames } from "./runtime/globals.js"
export type { Diagnostic, DiagnosticKind } from "./runtime/model.js"
export type { Json } from "./data.js"

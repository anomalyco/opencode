export * as VmEngine from "./index.js"

export { fromJson } from "./data.js"
export { execute, finishExecution, resumeProgram, type Running, type Setup, startProgram } from "./runtime/execute.js"
export { extensionGlobals } from "./runtime/extensions.js"
export { globalNames } from "./runtime/globals.js"
export { fromBytes, type Snapshot, SnapshotError, type SnapshotHeader, toBytes } from "./snapshot/snapshot.js"

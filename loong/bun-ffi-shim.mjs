// node-ffi shim for code that statically imports "bun:ffi" but never runs
// its win32-only call sites under node on Linux.
import * as nodeFfi from "node:ffi"
export const dlopen = nodeFfi.dlopen
export const ptr = (p) => p
export const unstable = { ffi: nodeFfi }

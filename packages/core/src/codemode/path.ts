export * as CodeModePath from "./path.js"

import { Extension } from "@opencode/codemode"
import path from "path"

// Only the functions and separators cross: `posix` and `win32` point back at the module, which a global cannot hold.
const { posix: _posix, win32: _win32, ...functions } = path.posix

export const extension = Extension.make({ name: "path", globals: { path: functions } })

export * as CodeModePath from "./path.js"

import { Extension } from "@opencode/codemode"
import { Effect, Option } from "effect"
import path from "path"
import { Location } from "../location.js"

// Only functions and separators cross; `posix` and `win32` point back at their module, which a global can't hold, so
// each becomes a copy of its own functions. Programs have no `process.cwd()`: the host's flavour resolves from the
// session's directory. The other flavour can't read that directory as absolute (`C:\\proj` isn't a POSIX path), so it
// resolves from its own root instead of falling back to the server's working directory.
const flavor = (module: path.PlatformPath) => {
  const { posix: _posix, win32: _win32, ...functions } = module
  const base: Effect.Effect<string> = module === path ? directory : Effect.succeed(module.sep)
  return {
    ...functions,
    resolve: (...parts: Array<string>) => Effect.map(base, (from) => module.resolve(from, ...parts)),
    relative: (from: string, to: string) =>
      Effect.map(base, (start) => module.relative(module.resolve(start, from), module.resolve(start, to))),
  }
}

// A run gets `path` only with the session's Location (see `CodeModeTool.create`).
const directory = Effect.flatMap(Effect.serviceOption(Location.Service), (location) =>
  Option.isSome(location) ? Effect.succeed(location.value.directory) : Effect.die("Code Mode path needs a Location."),
)

/** The host's own path module, as Node gives it, with `path.posix` and `path.win32`. */
export const extension = Extension.make({
  name: "path",
  globals: { path: { ...flavor(path), posix: flavor(path.posix), win32: flavor(path.win32) } },
})

export * as CodeModePath from "./path.js"

import { Extension } from "@opencode/codemode"
import { Effect, Option } from "effect"
import path from "path"
import { Environment } from "../environment/index.js"
import { Location } from "../location.js"

// Only functions and separators cross; `posix` and `win32` point back at their module, which a global can't hold, so
// each becomes a copy of its own functions. Programs have no `process.cwd()`: the default flavour resolves from the
// session's effective working directory (and its path rules when on a remote machine). The other flavour can't read
// that directory as absolute (`C:\\proj` isn't a POSIX path), so it resolves from its own root instead of falling back
// to the server's working directory.
const flavor = (module: path.PlatformPath) => {
  const { posix: _posix, win32: _win32, ...functions } = module
  const context: Effect.Effect<{ readonly directory: string; readonly rules: path.PlatformPath }> =
    module === path ? workingContext : Effect.succeed({ directory: module.sep, rules: module })
  return {
    ...functions,
    resolve: (...parts: Array<string>) =>
      Effect.map(context, (current) => current.rules.resolve(current.directory, ...parts)),
    relative: (from: string, to: string) =>
      Effect.map(context, (current) =>
        current.rules.relative(
          current.rules.resolve(current.directory, from),
          current.rules.resolve(current.directory, to),
        ),
      ),
  }
}

// A run gets `path` only with the session's Location (see `CodeModeTool.create`).
const workingContext = Effect.gen(function* () {
  const cwd = yield* Environment.CurrentWorkingDirectory
  if (cwd) return { directory: cwd.absolute, rules: cwd.environment.path ?? path }
  const location = yield* Effect.serviceOption(Location.Service)
  if (Option.isSome(location)) return { directory: location.value.directory, rules: path }
  return yield* Effect.die("Code Mode path needs a Location.")
})

/** The host's own path module, as Node gives it, with `path.posix` and `path.win32`. */
export const extension = Extension.make({
  name: "path",
  globals: { path: { ...flavor(path), posix: flavor(path.posix), win32: flavor(path.win32) } },
})

export * as CodeModePath from "./path.js"

import { Extension } from "@opencode/codemode"
import { Effect } from "effect"
import path from "path"
import { Location } from "../location.js"

// Only functions and separators cross; `posix` and `win32` point back at their module, which a global can't hold, so
// each becomes a copy of its own functions. Programs have no `process.cwd()`: the host's flavour resolves from the
// session's directory. The other flavour can't read that directory as absolute (`C:\\proj` isn't a POSIX path), so it
// resolves from its own root instead of falling back to the server's working directory.
const flavor = (module: path.PlatformPath) => {
  const { posix: _posix, win32: _win32, ...functions } = module
  const base = (directory: string) => (module === path ? directory : module.sep)
  return {
    ...functions,
    resolve: (...parts: Array<string>) =>
      Location.Service.use((location) => Effect.succeed(module.resolve(base(location.directory), ...parts))),
    relative: (from: string, to: string) =>
      Location.Service.use((location) =>
        Effect.succeed(
          module.relative(module.resolve(base(location.directory), from), module.resolve(base(location.directory), to)),
        ),
      ),
  }
}

/** The host's own path module, as Node gives it, with `path.posix` and `path.win32`. */
export const extension = Extension.make({
  name: "path",
  globals: { path: { ...flavor(path), posix: flavor(path.posix), win32: flavor(path.win32) } },
})

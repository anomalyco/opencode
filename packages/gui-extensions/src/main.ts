import { Extension } from "./sdk/main"
import context from "./context"
import btw from "./btw"
import debug from "./debug"
import terminal from "./terminal"
import file from "./file"
import review from "./review"
import details from "./details"
import browser from "./browser"
import pairing from "./pairing"
import updater from "./updater"
import ssh from "./ssh"
import wsl from "./wsl"

/**
 * Built-in extensions with their main entries. Lists every built-in so their ids stay reserved. `builtins.typecheck.ts`
 * checks that it provides every Ipc the renderer composition uses.
 */
export const builtins = Extension.compose(
  context,
  btw,
  debug,
  terminal,
  file,
  review,
  details,
  { ...browser, main: () => import("./browser/main") },
  { ...pairing, main: () => import("./pairing/main") },
  { ...updater, main: () => import("./updater/main") },
  { ...ssh, main: () => import("./ssh/main") },
  { ...wsl, main: () => import("./wsl/main") },
)

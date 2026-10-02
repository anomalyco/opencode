import type { Definition } from "./sdk/main"
import usage from "./usage"
import btw from "./btw"
import debug from "./debug"
import terminal from "./terminal"
import file from "./file"
import review from "./review"
import summary from "./summary"
import browser from "./browser"
import pairing from "./pairing"
import updater from "./updater"
import ssh from "./ssh"
import wsl from "./wsl"

/** Built-in extensions with their main entries. Lists every built-in so their ids stay reserved. */
export const builtins: readonly Definition[] = [
  usage,
  btw,
  debug,
  terminal,
  file,
  review,
  summary,
  { ...browser, main: () => import("./browser/main") },
  { ...pairing, main: () => import("./pairing/main") },
  { ...updater, main: () => import("./updater/main") },
  { ...ssh, main: () => import("./ssh/main") },
  { ...wsl, main: () => import("./wsl/main") },
]

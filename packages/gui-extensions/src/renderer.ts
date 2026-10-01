import type { Definition } from "./sdk"
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

/** Built-in extensions with their renderer entries. The only place host builds name extensions. */
export const builtins: readonly Definition[] = [
  { ...usage, renderer: () => import("./usage/renderer") },
  { ...btw, renderer: () => import("./btw/renderer") },
  { ...debug, renderer: () => import("./debug/renderer") },
  { ...terminal, renderer: () => import("./terminal/renderer") },
  { ...file, renderer: () => import("./file/renderer") },
  { ...review, renderer: () => import("./review/renderer") },
  { ...summary, renderer: () => import("./summary/renderer") },
  { ...browser, renderer: () => import("./browser/renderer") },
  { ...pairing, renderer: () => import("./pairing/renderer") },
  { ...updater, renderer: () => import("./updater/renderer") },
  { ...ssh, renderer: () => import("./ssh/renderer") },
  { ...wsl, renderer: () => import("./wsl/renderer") },
]

import type { Definition, Setup } from "./sdk"
import usage from "./usage"
import usageRenderer from "./usage/renderer"
import btw from "./btw"
import btwRenderer from "./btw/renderer"
import debug from "./debug"
import debugRenderer from "./debug/renderer"
import terminal from "./terminal"
import terminalRenderer from "./terminal/renderer"
import file from "./file"
import fileRenderer from "./file/renderer"
import review from "./review"
import reviewRenderer from "./review/renderer"
import summary from "./summary"
import summaryRenderer from "./summary/renderer"
import browser from "./browser"
import browserRenderer from "./browser/renderer"
import pairing from "./pairing"
import pairingRenderer from "./pairing/renderer"
import updater from "./updater"
import updaterRenderer from "./updater/renderer"
import ssh from "./ssh"
import sshRenderer from "./ssh/renderer"
import wsl from "./wsl"
import wslRenderer from "./wsl/renderer"

// The window renders once every built-in is active, so the small renderer entries load with the app, like the
// features they replaced. Heavy UI stays behind `lazy()` inside them.
const eager = (setup: Setup) => () => Promise.resolve({ default: setup })

/** Built-in extensions with their renderer entries. The only place host builds name extensions. */
export const builtins: readonly Definition[] = [
  { ...usage, renderer: eager(usageRenderer) },
  { ...btw, renderer: eager(btwRenderer) },
  { ...debug, renderer: eager(debugRenderer) },
  { ...terminal, renderer: eager(terminalRenderer) },
  { ...file, renderer: eager(fileRenderer) },
  { ...review, renderer: eager(reviewRenderer) },
  { ...summary, renderer: eager(summaryRenderer) },
  { ...browser, renderer: eager(browserRenderer) },
  { ...pairing, renderer: eager(pairingRenderer) },
  { ...updater, renderer: eager(updaterRenderer) },
  { ...ssh, renderer: eager(sshRenderer) },
  { ...wsl, renderer: eager(wslRenderer) },
]

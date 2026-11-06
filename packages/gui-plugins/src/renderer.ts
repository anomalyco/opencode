import { compose, type Entry } from "@opencode/plugin/gui/host"
import context from "./context"
import contextRenderer from "./context/renderer"
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
import details from "./details"
import detailsRenderer from "./details/renderer"
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
import microsoftOffice from "./microsoft-office"
import microsoftOfficeRenderer from "./microsoft-office/renderer"
import sources from "./sources"
import sourcesRenderer from "./sources/renderer"

// The window renders once every built-in is active, so the small renderer entries load with the app, like the
// features they replaced. Heavy UI stays behind `lazy()` inside them.
const eager = (setup: Awaited<ReturnType<NonNullable<Entry["windowEntry"]>>>["default"]) => () =>
  Promise.resolve({ default: setup })

/** Built-in plugins with their window entries, by id. The only place host builds name built-ins. */
export const builtins = compose({
  context: { ...context, windowEntry: eager(contextRenderer) },
  btw: { ...btw, windowEntry: eager(btwRenderer) },
  debug: { ...debug, windowEntry: eager(debugRenderer) },
  terminal: { ...terminal, windowEntry: eager(terminalRenderer) },
  file: { ...file, windowEntry: eager(fileRenderer) },
  review: { ...review, windowEntry: eager(reviewRenderer) },
  details: { ...details, windowEntry: eager(detailsRenderer) },
  browser: { ...browser, windowEntry: eager(browserRenderer) },
  pairing: { ...pairing, windowEntry: eager(pairingRenderer) },
  updater: { ...updater, windowEntry: eager(updaterRenderer) },
  ssh: { ...ssh, windowEntry: eager(sshRenderer) },
  wsl: { ...wsl, windowEntry: eager(wslRenderer) },
  "microsoft-office": { ...microsoftOffice, windowEntry: eager(microsoftOfficeRenderer) },
  sources: { ...sources, windowEntry: eager(sourcesRenderer) },
})

import { Extension, type Definition } from "./sdk"
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

// The window renders once every built-in is active, so the small renderer entries load with the app, like the
// features they replaced. Heavy UI stays behind `lazy()` inside them.
const eager = (setup: Awaited<ReturnType<NonNullable<Definition["renderer"]>>>["default"]) => () =>
  Promise.resolve({ default: setup })

/**
 * Built-in extensions with their renderer entries. The only place host builds name extensions. `builtins.typecheck.ts`
 * checks this composition against the main one.
 */
export const builtins = Extension.compose(
  { ...context, renderer: eager(contextRenderer) },
  { ...btw, renderer: eager(btwRenderer) },
  { ...debug, renderer: eager(debugRenderer) },
  { ...terminal, renderer: eager(terminalRenderer) },
  { ...file, renderer: eager(fileRenderer) },
  { ...review, renderer: eager(reviewRenderer) },
  { ...details, renderer: eager(detailsRenderer) },
  { ...browser, renderer: eager(browserRenderer) },
  { ...pairing, renderer: eager(pairingRenderer) },
  { ...updater, renderer: eager(updaterRenderer) },
  { ...ssh, renderer: eager(sshRenderer) },
  { ...wsl, renderer: eager(wslRenderer) },
  { ...microsoftOffice, renderer: eager(microsoftOfficeRenderer) },
)

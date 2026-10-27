import { compose } from "@opencode/plugin/gui/host"
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
import microsoftOffice from "./microsoft-office"
import sources from "./sources"

/** Built-in plugins with their main entries, by id. Lists every built-in so their ids stay reserved. */
export const builtins = compose({
  context,
  btw,
  debug: { ...debug, mainEntry: () => import("./debug/main") },
  terminal,
  file,
  review,
  details,
  browser: { ...browser, mainEntry: () => import("./browser/main") },
  pairing: { ...pairing, mainEntry: () => import("./pairing/main") },
  updater: { ...updater, mainEntry: () => import("./updater/main") },
  ssh: { ...ssh, mainEntry: () => import("./ssh/main") },
  wsl: { ...wsl, mainEntry: () => import("./wsl/main") },
  "microsoft-office": microsoftOffice,
  sources,
})

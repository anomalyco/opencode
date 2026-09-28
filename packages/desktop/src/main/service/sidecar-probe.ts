import { readFileSync } from "node:fs"
import path from "node:path"
import { app } from "electron"
import type { Endpoint } from "@opencode/client/service"

// The main thread idles between showing the first window and evaluating the main bundle, waiting
// for the renderer's asset requests. That slot is long enough to find out whether a compatible
// background service is already running, so the renderer's first data request is not the first
// moment anyone asks. The probe only looks; a service that has to be started waits for the layers,
// which set the environment the CLI expects.
let probe: Promise<Endpoint | undefined> | undefined

export function startSidecarProbe() {
  if (!app.isPackaged) return
  const version = bundledVersion()
  if (!version) return
  probe = import("@opencode/client/service")
    .then(({ Service }) => Service.discover({ version }))
    .catch(() => undefined)
}

export function sidecarProbe() {
  return probe ?? Promise.resolve(undefined)
}

function bundledVersion() {
  try {
    return readFileSync(path.join(process.resourcesPath, "opencode-cli.version"), "utf8").trim()
  } catch {
    return ""
  }
}

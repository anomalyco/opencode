import { app } from "electron"
import { acquireApplicationLock, configureApplication } from "./lifecycle/configure"
import { createEarlyWindow } from "./windows/early"
import { registerRendererScheme } from "./windows/scheme"

// This module stays small on purpose. Electron holds the ready event until the entry module has
// finished, and the first window should be on screen before the rest of the main process — a few
// hundred milliseconds of module evaluation and layers — loads. Configuration and the scheme must
// precede ready; the window is created the moment ready fires; everything else is imported after.
configureApplication()
if (acquireApplicationLock()) {
  registerRendererScheme()
  // Window first, then the bundle: starting the import before ready delays ready itself, because the
  // module graph evaluates on the same thread Chromium needs to finish initialising.
  void app.whenReady().then(() => {
    createEarlyWindow()
    return import("./desktop")
  })
}

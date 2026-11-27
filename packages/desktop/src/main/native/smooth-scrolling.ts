import { app } from "electron"
import { SMOOTH_SCROLLING_ENABLED_KEY } from "../storage/keys"
import { getStore } from "../storage/store"

// Chromium animates each mouse-wheel notch on Linux; native Linux apps scroll by the full delta immediately,
// so animated scrolling is opt-in there. Chromium reads the switch at launch, so a change applies after a relaunch.
export function applySmoothScrolling() {
  if (process.platform === "linux" && !getSmoothScrollingEnabled())
    app.commandLine.appendSwitch("disable-smooth-scrolling")
}

export function getSmoothScrollingEnabled() {
  return getStore().get(SMOOTH_SCROLLING_ENABLED_KEY) === true
}

export function setSmoothScrollingEnabled(enabled: boolean) {
  getStore().set(SMOOTH_SCROLLING_ENABLED_KEY, enabled)
}

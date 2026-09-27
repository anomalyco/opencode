import { powerSaveBlocker } from "electron"
import type { DesktopStorage } from "../storage"
import { KEEP_SCREEN_ACTIVE_KEY, SETTINGS_STORE } from "../storage/keys"

export function createScreenActivity(storage: DesktopStorage.Interface) {
  const state = { blocker: undefined as number | undefined }
  const dispose = () => {
    if (state.blocker === undefined) return
    powerSaveBlocker.stop(state.blocker)
    state.blocker = undefined
  }
  const set = (enabled: boolean) => {
    if (enabled && state.blocker === undefined) {
      state.blocker = powerSaveBlocker.start("prevent-display-sleep")
    }
    if (!enabled) dispose()
    storage.state.set(SETTINGS_STORE, KEEP_SCREEN_ACTIVE_KEY, JSON.stringify(enabled))
  }
  if (storage.state.get(SETTINGS_STORE, KEEP_SCREEN_ACTIVE_KEY) === "true") set(true)
  return {
    get: () => state.blocker !== undefined && powerSaveBlocker.isStarted(state.blocker),
    set,
    dispose,
  }
}

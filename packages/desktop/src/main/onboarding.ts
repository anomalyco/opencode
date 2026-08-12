import { existsSync, readdirSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"
import { getStore } from "./store"
import { FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY, OLD_LAYOUT_ELIGIBLE_KEY } from "./store-keys"
import { write as writeLog } from "./logging"
import { hasExistingAppStateAny } from "./install-state"
import { tauriAppId, tauriDir } from "./migrate"

const DEFAULT_PROJECT_DIR = "Default Project"

function listEntries(directory: string) {
  return existsSync(directory) ? readdirSync(directory, { withFileTypes: true }) : []
}

export function initializeOldLayoutEligibility(userDataPath: string) {
  const store = getStore()
  const current = store.get(OLD_LAYOUT_ELIGIBLE_KEY)
  if (typeof current === "boolean") return current

  const entries = listEntries(userDataPath)
  // The previous Tauri desktop app stored its state in a different directory on
  // Linux/macOS (e.g. ~/.local/share/ai.opencode.desktop). Treat existing state
  // there the same as the Electron userData so users can still opt back into the
  // previous layout.
  const tauriEntries = listEntries(tauriDir(tauriAppId()))

  const eligible = hasExistingAppStateAny(entries, tauriEntries)
  store.set(OLD_LAYOUT_ELIGIBLE_KEY, eligible)
  return eligible
}

export function isOldLayoutEligible() {
  return getStore().get(OLD_LAYOUT_ELIGIBLE_KEY) === true
}

export function isFirstLaunchOnboardingPending() {
  const pending = getStore().get(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY) !== true
  writeLog("onboarding", "first launch onboarding pending checked", { pending })
  return pending
}

export async function finishFirstLaunchOnboarding(createDefaultProject: boolean) {
  if (!isFirstLaunchOnboardingPending()) {
    writeLog("onboarding", "first launch onboarding already completed")
    return null
  }

  const defaultProject = createDefaultProject ? join(app.getPath("documents"), DEFAULT_PROJECT_DIR) : null
  if (defaultProject) await mkdir(defaultProject, { recursive: true })

  getStore().set(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY, true)
  writeLog("onboarding", "first launch onboarding completed", { createDefaultProject, defaultProject })
  return defaultProject
}

import { existsSync, readdirSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"
import { writeLog } from "../native/logging"
import { hasExistingAppState } from "../storage/install-state"
import { FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY } from "../storage/keys"
import { getStore } from "../storage/store"

const DEFAULT_PROJECT_DIR = "Default Project"

export function initializeFirstLaunchOnboarding(userDataPath: string) {
  const entries = existsSync(userDataPath) ? readdirSync(userDataPath, { withFileTypes: true }) : []
  const store = getStore()
  const current = store.get(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY)
  if (typeof current === "boolean") return current

  const complete = hasExistingAppState(entries)
  store.set(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY, complete)
  return complete
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

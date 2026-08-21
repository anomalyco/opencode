import { app } from "electron"
import { Effect, FileSystem, Option, Path } from "effect"
import { scoped } from "../native/logging"
import { hasExistingAppState } from "../storage/install-state"
import { FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY } from "../storage/keys"
import { getStore } from "../storage/store"

const DEFAULT_PROJECT_DIR = "Default Project"

export const initializeFirstLaunchOnboarding = Effect.fn("Onboarding.initialize")(function* (userDataPath: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const names = (yield* fs.exists(userDataPath)) ? yield* fs.readDirectory(userDataPath) : []
  const entries = yield* Effect.forEach(
    names,
    Effect.fnUntraced(function* (name) {
      const info = yield* fs.stat(path.join(userDataPath, name)).pipe(Effect.option)
      return { name, directory: Option.isSome(info) && info.value.type === "Directory" }
    }),
  )
  const store = getStore()
  const current = store.get(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY)
  if (typeof current === "boolean") return current

  const complete = hasExistingAppState(entries)
  store.set(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY, complete)
  return complete
})

export const isFirstLaunchOnboardingPending = Effect.fn("Onboarding.isPending")(function* () {
  const pending = getStore().get(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY) !== true
  yield* scoped("onboarding", Effect.logInfo("first launch onboarding pending checked", { pending }))
  return pending
})

export const finishFirstLaunchOnboarding = Effect.fn("Onboarding.finish")(function* (createDefaultProject: boolean) {
  if (!(yield* isFirstLaunchOnboardingPending())) {
    yield* scoped("onboarding", Effect.logInfo("first launch onboarding already completed"))
    return null
  }

  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const defaultProject = createDefaultProject ? path.join(app.getPath("documents"), DEFAULT_PROJECT_DIR) : null
  if (defaultProject) yield* fs.makeDirectory(defaultProject, { recursive: true })

  getStore().set(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY, true)
  yield* scoped(
    "onboarding",
    Effect.logInfo("first launch onboarding completed", { createDefaultProject, defaultProject }),
  )
  return defaultProject
})

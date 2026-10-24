import { app } from "electron"
import { Effect, FileSystem, Option, Path } from "effect"
import { scoped } from "../native/logging"
import { hasExistingAppState } from "../storage/install-state"
import { FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY } from "../storage/keys"
import { getStore } from "../storage/store"
import { nativeT } from "../native/translations"
import { DefaultProject } from "./default-project"

export const initializeFirstLaunchOnboarding = Effect.fn("Onboarding.initialize")(function* (userDataPath: string) {
  const store = getStore()
  const current = store.get(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY)

  // This is the folder Desktop created, not an arbitrary saved project. Keep the original
  // path across locale changes and restore it before any restored tab requests its catalogs.
  yield* DefaultProject.restore(store).pipe(
    Effect.catch((error) => scoped("onboarding", Effect.logWarning("failed to restore default project", { error }))),
  )

  if (typeof current === "boolean") return current

  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const names = (yield* fs.exists(userDataPath)) ? yield* fs.readDirectory(userDataPath) : []

  const entries = yield* Effect.forEach(
    names,
    Effect.fnUntraced(function* (name) {
      const info = yield* fs.stat(path.join(userDataPath, name)).pipe(Effect.option)

      return { name, directory: Option.isSome(info) && info.value.type === "Directory" }
    }),
    { concurrency: "unbounded" },
  )

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

  const path = yield* Path.Path

  const defaultProject = createDefaultProject
    ? path.join(app.getPath("documents"), nativeT("desktop.onboarding.defaultProject"))
    : null

  if (defaultProject) yield* DefaultProject.create(getStore(), defaultProject)

  getStore().set(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY, true)
  yield* scoped(
    "onboarding",
    Effect.logInfo("first launch onboarding completed", { createDefaultProject, defaultProject }),
  )

  return defaultProject
})

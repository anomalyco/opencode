import { app } from "electron"
import { Effect, Exit, FileSystem, Option, Path, Predicate } from "effect"
import { scoped } from "../native/logging"
import { hasExistingAppState } from "../storage/install-state"
import { FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY } from "../storage/keys"
import { getStore } from "../storage/store"
import { nativeT } from "../native/translations"
import {
  createMainOnboardingState,
  selectOnboardingPending,
  transitionMainOnboarding,
  type MainOnboardingEvent,
} from "./onboarding-machine"

const onboarding = { state: createMainOnboardingState() }

// Records completion at once; the caller runs the directory it is handed.
const dispatch = (event: MainOnboardingEvent) => {
  const next = transitionMainOnboarding(onboarding.state, event)
  onboarding.state = next.state

  if (next.commands.some((command) => command.type === "persist-complete"))
    getStore().set(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY, true)

  return next.commands
}

export const initializeFirstLaunchOnboarding = Effect.fn("Onboarding.initialize")(function* (userDataPath: string) {
  const store = getStore()
  const current = store.get(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY)

  if (Predicate.isBoolean(current)) {
    dispatch({ type: "initialized", complete: current })

    return current
  }

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
  dispatch({ type: "initialized", complete })

  return complete
})

export const isFirstLaunchOnboardingPending = Effect.fn("Onboarding.isPending")(function* () {
  const pending = selectOnboardingPending(onboarding.state)
  yield* scoped("onboarding", Effect.logInfo("first launch onboarding pending checked", { pending }))

  return pending
})

export const finishFirstLaunchOnboarding = Effect.fn("Onboarding.finish")(function* (createDefaultProject: boolean) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const defaultProject = createDefaultProject
    ? path.join(app.getPath("documents"), nativeT("desktop.onboarding.defaultProject"))
    : null

  // Claimed before the first await, so a second window finishing meanwhile neither creates the project nor opens a draft.
  const commands = dispatch({ type: "finish.requested", directory: defaultProject })
  const make = commands.find((command) => command.type === "make-directory")

  if (commands.length === 0) {
    yield* scoped("onboarding", Effect.logInfo("first launch onboarding already completed"))

    return null
  }

  if (make) {
    const attempt = make.attempt
    yield* fs
      .makeDirectory(make.directory, { recursive: true })
      .pipe(
        Effect.onExit((exit) =>
          Effect.sync(() =>
            dispatch(Exit.isSuccess(exit) ? { type: "finish.succeeded", attempt } : { type: "finish.failed", attempt }),
          ),
        ),
      )
  }

  yield* scoped(
    "onboarding",
    Effect.logInfo("first launch onboarding completed", { createDefaultProject, defaultProject }),
  )

  return defaultProject
})

import type { UpdaterState } from "@opencode-ai/app/updater"

export type { UpdaterState } from "@opencode-ai/app/updater"

export type UpdaterReadyRecord = { version: string }

export type UpdaterPlatform = {
  checkForUpdate(): Promise<string | undefined>
  stageUpdate(): Promise<unknown>
  installAndRestart(): Promise<never>
}

export type UpdaterLifecycle = {
  prepareToRestart(): Promise<void>
}

type UpdaterPersistence = {
  get(): UpdaterReadyRecord | undefined | Promise<UpdaterReadyRecord | undefined>
  set(value: UpdaterReadyRecord): void | Promise<void>
  clear(): void | Promise<void>
}

export function createUpdaterController(input: {
  currentVersion: string
  platform?: UpdaterPlatform
  lifecycle: UpdaterLifecycle
  persistence: UpdaterPersistence
  log?: (message: string, data?: object) => void
}) {
  let state: UpdaterState = input.platform ? { status: "idle" } : { status: "disabled" }
  let pending: Promise<UpdaterState> | undefined
  let installing: Promise<void> | undefined
  const listeners = new Set<(state: UpdaterState) => void>()

  const transition = (next: UpdaterState) => {
    input.log?.("updater state changed", { from: state.status, to: next.status })
    state = next
    listeners.forEach((listener) => listener(state))
    return state
  }

  const check = () => {
    const platform = input.platform
    if (!platform) return Promise.resolve(state)
    if (state.status === "installing") return Promise.resolve(state)
    if (pending) return pending

    pending = (state.status === "ready" ? refreshStaged(platform, state.version) : findAndStage(platform)).finally(
      () => {
        pending = undefined
      },
    )
    return pending
  }

  const findAndStage = (platform: UpdaterPlatform) =>
    (async () => {
      transition({ status: "checking" })
      const version = await platform.checkForUpdate()
      if (!version || version === input.currentVersion) {
        await input.persistence.clear()
        return transition({ status: "up-to-date" })
      }

      transition({ status: "downloading", version })
      await platform.stageUpdate()
      await input.persistence.set({ version })
      return transition({ status: "ready", version })
    })().catch((error) =>
      transition({ status: "error", message: error instanceof Error ? error.message : String(error) }),
    )

  // A staged update stays visible and installable throughout: the refresh makes no
  // transitions until a newer version is staged, and a failure keeps the current one.
  const refreshStaged = (platform: UpdaterPlatform, staged: string) =>
    (async () => {
      const version = await platform.checkForUpdate()
      if (!version || version === staged || version === input.currentVersion) return state

      await platform.stageUpdate()
      await input.persistence.set({ version })
      // An install may have started while this stage was in flight; keep its status
      // and show the newer version instead of flickering back to ready.
      return transition({ status: installing ? "installing" : "ready", version })
    })().catch((error) => {
      input.log?.("updater refresh failed, keeping staged update", {
        staged,
        message: error instanceof Error ? error.message : String(error),
      })
      return state
    })

  const install = () => {
    if (installing) return installing
    const platform = input.platform
    if (!platform || state.status !== "ready") return Promise.reject(new Error("Update is not ready to install"))

    const staged = state.version
    transition({ status: "installing", version: staged })
    installing = (async () => {
      // Installation is the commit point: refresh once more so one restart lands
      // on the newest release, or keep the known-good staged update if checking fails.
      await (pending ?? refreshStaged(platform, staged))
      await input.lifecycle.prepareToRestart()
      await platform.installAndRestart()
    })().catch((error) => {
      installing = undefined
      if (state.status === "installing") transition({ status: "ready", version: state.version })
      throw error
    })
    return installing
  }

  return {
    getState: () => state,
    subscribe(listener: (state: UpdaterState) => void) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    async start() {
      const ready = await input.persistence.get()
      if (ready?.version === input.currentVersion) await input.persistence.clear()
      return check()
    },
    check,
    install,
  }
}

export type UpdaterController = ReturnType<typeof createUpdaterController>

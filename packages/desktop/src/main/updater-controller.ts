import type { MajorUpdateState, UpdaterState } from "@opencode-ai/app/updater"

export type { MajorUpdateState, UpdaterState } from "@opencode-ai/app/updater"

export type UpdaterReadyRecord = { version: string }

export type UpdaterBackend = {
  checkForUpdates(): Promise<{ isUpdateAvailable?: boolean; updateInfo?: { version?: string } } | null | undefined>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

type UpdaterPersistence = {
  get(): UpdaterReadyRecord | undefined | Promise<UpdaterReadyRecord | undefined>
  set(value: UpdaterReadyRecord): void | Promise<void>
  clear(): void | Promise<void>
}

export function createUpdaterController(input: {
  enabled: boolean
  currentVersion: string
  backend: UpdaterBackend
  // Reads the OpenCode 2 feed. Without it, OpenCode 2 is never offered.
  major?: UpdaterBackend
  persistence: UpdaterPersistence
  stop: () => Promise<void>
  log?: (message: string, data?: object) => void
}) {
  let state: UpdaterState = input.enabled ? { status: "idle" } : { status: "disabled" }
  let major: MajorUpdateState = { status: "unavailable" }
  let pending: Promise<UpdaterState> | undefined
  let prompted = false
  const listeners = new Set<(state: UpdaterState) => void>()
  const majorListeners = new Set<(state: MajorUpdateState) => void>()

  const transition = (next: UpdaterState) => {
    input.log?.("updater state changed", { from: state.status, to: next.status })
    state = next
    listeners.forEach((listener) => listener(state))
    return state
  }

  const transitionMajor = (next: MajorUpdateState) => {
    input.log?.("major updater state changed", { from: major.status, to: next.status })
    major = next
    majorListeners.forEach((listener) => listener(major))
    return major
  }

  const check = () => {
    if (!input.enabled) return Promise.resolve(state)
    if (state.status === "ready") return Promise.resolve(state)
    // Once the user picks OpenCode 2, an OpenCode 1 release must not download over it.
    if (major.status === "installing" || major.status === "installed") return Promise.resolve(state)
    if (pending) return pending

    pending = (async () => {
      transition({ status: "checking" })
      const result = await input.backend.checkForUpdates()
      const version = result?.updateInfo?.version
      if (!result?.isUpdateAvailable || !version || version === input.currentVersion) {
        await input.persistence.clear()
        if (input.major && major.status === "unavailable") transitionMajor({ status: "available" })
        return transition({ status: "up-to-date" })
      }

      if (major.status !== "unavailable") transitionMajor({ status: "unavailable" })
      transition({ status: "downloading", version })
      await input.backend.downloadUpdate()
      await input.persistence.set({ version })
      return transition({ status: "ready", version })
    })()
      .catch((error) =>
        transition({ status: "error", message: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => {
        pending = undefined
      })
    return pending
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
    async install() {
      if (state.status !== "ready") throw new Error("Update is not ready to install")
      const version = state.version
      transition({ status: "installing", version })
      await input
        .stop()
        .then(() => {
          input.backend.quitAndInstall()
          transition({ status: "ready", version })
        })
        .catch((error) => {
          transition({ status: "ready", version })
          throw error
        })
    },
    major: {
      getState: () => major,
      subscribe(listener: (state: MajorUpdateState) => void) {
        majorListeners.add(listener)
        listener(major)
        return () => majorListeners.delete(listener)
      },
      prompt() {
        if (prompted) return false
        prompted = true
        return true
      },
      // Nothing downloads until the user picks Upgrade.
      async install() {
        const backend = input.major
        if (!backend || (major.status !== "available" && major.status !== "failed")) return
        transitionMajor({ status: "installing" })
        await backend
          .checkForUpdates()
          .then(async (result) => {
            if (!result?.isUpdateAvailable) return transitionMajor({ status: "failed" })
            await backend.downloadUpdate()
            return transitionMajor({ status: "installed" })
          })
          .catch((error) =>
            transitionMajor({ status: "failed", message: error instanceof Error ? error.message : String(error) }),
          )
      },
      async restart() {
        if (!input.major || major.status !== "installed") throw new Error("OpenCode 2 is not ready to install")
        await input.stop()
        input.major.quitAndInstall()
      },
    },
  }
}

export type UpdaterController = ReturnType<typeof createUpdaterController>

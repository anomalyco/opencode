import type { MajorUpdateState, UpdaterState } from "@opencode-ai/app/updater"

export type { MajorUpdateState, UpdaterState } from "@opencode-ai/app/updater"

export type UpdaterReadyRecord = { version: string }

export type UpdaterBackend = {
  checkForUpdates(): Promise<{ isUpdateAvailable?: boolean; updateInfo?: { version?: string } } | null | undefined>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

// The OpenCode 2 updater can also install when the app quits, without a restart.
export type MajorUpdaterBackend = UpdaterBackend & { installOnQuit(): Promise<unknown> }

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
  major?: MajorUpdaterBackend
  persistence: UpdaterPersistence
  stop: () => Promise<void>
  log?: (message: string, data?: object) => void
}) {
  let state: UpdaterState = input.enabled ? { status: "idle" } : { status: "disabled" }
  let major: MajorUpdateState = { status: "unavailable" }
  let pending: Promise<UpdaterState> | undefined
  let preparing: Promise<void> | undefined
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

  // Downloads OpenCode 2 ahead of the offer, the way an OpenCode 1 update downloads. A failure stays quiet and the next
  // check tries again, because the user has not asked for anything yet.
  const prepare = () => {
    const backend = input.major
    if (!backend || preparing || major.status !== "unavailable") return
    transitionMajor({ status: "downloading" })
    preparing = backend
      .checkForUpdates()
      .then(async (result) => {
        if (!result?.isUpdateAvailable) return false
        await backend.downloadUpdate()
        return true
      })
      .catch((error) => {
        input.log?.("major update download failed", { message: error instanceof Error ? error.message : String(error) })
        return false
      })
      .then((downloaded) => {
        preparing = undefined
        // A newer OpenCode 1 release can withdraw the offer while OpenCode 2 downloads.
        if (major.status !== "downloading") return
        transitionMajor(downloaded ? { status: "ready" } : { status: "unavailable" })
      })
  }

  const check = () => {
    if (!input.enabled) return Promise.resolve(state)
    if (state.status === "ready") return Promise.resolve(state)
    // Once the user picks OpenCode 2, an OpenCode 1 release must not download over it.
    if (major.status === "scheduled") return Promise.resolve(state)
    if (pending) return pending

    pending = (async () => {
      transition({ status: "checking" })
      const result = await input.backend.checkForUpdates()
      const version = result?.updateInfo?.version
      if (!result?.isUpdateAvailable || !version || version === input.currentVersion) {
        await input.persistence.clear()
        prepare()
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
      // Nothing installs until the user picks one of these two.
      async restart() {
        const backend = input.major
        if (!backend || (major.status !== "ready" && major.status !== "scheduled"))
          throw new Error("OpenCode 2 is not ready to install")
        await input.stop()
        backend.quitAndInstall()
      },
      async schedule() {
        const backend = input.major
        if (!backend || major.status !== "ready") return
        await backend.installOnQuit()
        transitionMajor({ status: "scheduled" })
      },
    },
  }
}

export type UpdaterController = ReturnType<typeof createUpdaterController>

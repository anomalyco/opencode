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
  enabled: boolean
  currentVersion: string
  platform?: UpdaterPlatform
  lifecycle: UpdaterLifecycle
  persistence: UpdaterPersistence
  log?: (message: string, data?: object) => void
}) {
  let state: UpdaterState = input.enabled ? { status: "idle" } : { status: "disabled" }
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
    if (!input.enabled) return Promise.resolve(state)
    const platform = input.platform
    if (!platform) return Promise.resolve(state)
    if (state.status === "ready" || state.status === "installing") return Promise.resolve(state)
    if (pending) return pending

    pending = (async () => {
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
    })()
      .catch((error) =>
        transition({ status: "error", message: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => {
        pending = undefined
      })
    return pending
  }

  const install = () => {
    if (installing) return installing
    if (state.status !== "ready") return Promise.reject(new Error("Update is not ready to install"))

    const version = startInstalling(state.version)
    installing = restartWithUpdate(version)
    return installing
  }

  const startInstalling = (version: string) => {
    transition({ status: "installing", version })
    return version
  }

  const restartWithUpdate = (version: string) =>
    prepareAndRestart().catch((error) => {
      installing = undefined
      transition({ status: "ready", version })
      throw error
    })

  const prepareAndRestart = async () => {
    if (!input.platform) throw new Error("Updater is disabled")
    await input.lifecycle.prepareToRestart()
    await input.platform.installAndRestart()
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

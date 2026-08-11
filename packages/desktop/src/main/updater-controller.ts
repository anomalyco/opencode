import type { UpdaterState } from "@opencode-ai/app/updater"

export type { UpdaterState } from "@opencode-ai/app/updater"

export type UpdaterReadyRecord = { version: string }

export type UpdaterPlatform = {
  checkForUpdate(): Promise<{ isUpdateAvailable?: boolean; updateInfo?: { version?: string } } | null | undefined>
  stageUpdate(): Promise<unknown>
  installAndRestart(): Promise<never>
}

type UpdaterPersistence = {
  get(): UpdaterReadyRecord | undefined | Promise<UpdaterReadyRecord | undefined>
  set(value: UpdaterReadyRecord): void | Promise<void>
  clear(): void | Promise<void>
}

export function createUpdaterController(input: {
  enabled: boolean
  currentVersion: string
  platform: UpdaterPlatform
  persistence: UpdaterPersistence
  log?: (message: string, data?: object) => void
}) {
  let state: UpdaterState = input.enabled ? { status: "idle" } : { status: "disabled" }
  let pending: Promise<UpdaterState> | undefined
  let installing: Promise<never> | undefined
  const listeners = new Set<(state: UpdaterState) => void>()

  const transition = (next: UpdaterState) => {
    input.log?.("updater state changed", { from: state.status, to: next.status })
    state = next
    listeners.forEach((listener) => listener(state))
    return state
  }

  const check = () => {
    if (!input.enabled) return Promise.resolve(state)
    if (state.status === "ready" || state.status === "installing") return Promise.resolve(state)
    if (pending) return pending

    pending = (async () => {
      transition({ status: "checking" })
      const result = await input.platform.checkForUpdate()
      const version = result?.updateInfo?.version
      if (!result?.isUpdateAvailable || !version || version === input.currentVersion) {
        await input.persistence.clear()
        return transition({ status: "up-to-date" })
      }

      transition({ status: "downloading", version })
      await input.platform.stageUpdate()
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
    installing = restartWithUpdate(version).finally(() => {
      installing = undefined
    })
    return installing
  }

  const startInstalling = (version: string) => {
    transition({ status: "installing", version })
    return version
  }

  const restartWithUpdate = (version: string) =>
    input.platform.installAndRestart().catch((error) => {
      transition({ status: "ready", version })
      throw error
    })

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

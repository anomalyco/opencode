import type { MajorUpdatePrompt, MajorUpdateState, UpdaterState } from "@opencode-ai/app/updater"

export type { MajorUpdatePrompt, MajorUpdateState, UpdaterState } from "@opencode-ai/app/updater"

export type UpdaterReadyRecord = { version: string }

// The offer opens by itself only this soon after the app starts. Later than this, the user is already working.
export const LAUNCH_WINDOW = 30 * 1000

// OpenCode 1 only offers the next major release. A feed that answers with anything older is ignored.
const MAJOR_VERSION = 2

export type UpdaterBackend = {
  checkForUpdates(): Promise<{ isUpdateAvailable?: boolean; updateInfo?: { version?: string } } | null | undefined>
  downloadUpdate(): Promise<unknown>
  // Throws when the installer could not start, so the app keeps running.
  quitAndInstall(): void
}

export type MajorUpdaterBackend = UpdaterBackend & {
  // Aborts a download in flight, which then rejects.
  cancelDownload(): void
  // Hands the downloaded OpenCode 2 to the platform installer, so quitAndInstall has nothing left to wait for. Resolves
  // true where that cannot be taken back: on macOS, an update that Squirrel has staged installs at the next quit.
  stage(): Promise<boolean>
  // Arms the install for the next quit and resolves once it is certain to run. Missing where an install cannot run
  // while the app quits; Upgrade on quit is not offered there.
  installOnQuit?: () => Promise<unknown>
  // Takes installOnQuit back, where the platform can.
  disarm(): void
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
  major?: MajorUpdaterBackend
  persistence: UpdaterPersistence
  stop: () => Promise<void>
  // Milliseconds on a clock that only moves forward. The launch window is measured from the first reading.
  now?: () => number
  log?: (message: string, data?: object) => void
}) {
  const now = input.now ?? (() => performance.now())
  const started = now()
  let state: UpdaterState = input.enabled ? { status: "idle" } : { status: "disabled" }
  let major: MajorUpdateState = { status: "unavailable" }
  let pending: Promise<UpdaterState> | undefined
  let preparing: Promise<void> | undefined
  let scheduling: Promise<void> | undefined
  let installing: Promise<void> | undefined
  let prompted = false
  let asked = false
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

  // Once the user picks OpenCode 2, an OpenCode 1 release must not download over it.
  const chosen = () => major.status === "scheduling" || major.status === "scheduled" || major.status === "installing"

  // Downloads OpenCode 2 ahead of the offer, the way an OpenCode 1 update downloads. A failure stays quiet and the next
  // check tries again, because the user has not asked for anything yet.
  const prepare = () => {
    const backend = input.major
    if (!backend || preparing || major.status !== "unavailable") return
    transitionMajor({ status: "downloading" })
    preparing = backend
      .checkForUpdates()
      .then(async (result) => {
        if (!result?.isUpdateAvailable || !isMajor(result.updateInfo?.version)) return false
        // A newer OpenCode 1 release can withdraw the offer while the feed answers.
        if (major.status !== "downloading") return false
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
        transitionMajor(
          downloaded ? { status: "ready", quit: backend.installOnQuit !== undefined } : { status: "unavailable" },
        )
      })
  }

  // A newer OpenCode 1 release wins. The two updaters must never download at the same time, so this resolves only once
  // the OpenCode 2 download has ended.
  const withdraw = async () => {
    asked = false
    if (major.status !== "unavailable") {
      transitionMajor({ status: "unavailable" })
      input.major?.cancelDownload()
      input.major?.disarm()
    }
    await preparing
  }

  const check = () => {
    if (!input.enabled) return Promise.resolve(state)
    if (state.status === "ready") return Promise.resolve(state)
    if (chosen()) return Promise.resolve(state)
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

      // The user can pick OpenCode 2 while the feed answers.
      if (chosen()) return transition({ status: "idle" })
      await withdraw()
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
    // A check the user asked for. It also waits for OpenCode 2 to finish downloading, so the answer is never "up to
    // date" while the upgrade is still on its way.
    async checkNow() {
      await check()
      await preparing
      return state
    },
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
      // Whether the calling window opens the offer by itself. Every window asks once the offer exists, and the answer
      // is decided here, so a window that opens or reloads later never starts a launch window of its own.
      prompt(): MajorUpdatePrompt {
        if (asked) {
          asked = false
          return "asked"
        }
        if (prompted || now() - started > LAUNCH_WINDOW) return
        prompted = true
        return "launch"
      },
      // The user asked for the offer while no window could show it. The next window to prompt opens it.
      ask() {
        asked = true
      },
      // Nothing installs until the user picks one of these two.
      restart() {
        const backend = input.major
        // The installer must start once, so every later call joins the first.
        if (installing) return installing
        if (!backend || (major.status !== "ready" && major.status !== "scheduled"))
          return Promise.reject(new Error("OpenCode 2 is not ready to install"))
        const failed = { state: major, stopped: false }
        transitionMajor({ status: "installing" })
        installing = (async () => {
          if (failed.state.status === "ready" && (await backend.stage())) failed.state = { status: "scheduled" }
          failed.stopped = true
          await input.stop()
          backend.quitAndInstall()
        })().catch((error) => {
          installing = undefined
          // The servers are gone by now, so the app has to restart before it works again.
          transitionMajor(failed.stopped ? { ...failed.state, stopped: true } : failed.state)
          throw error
        })
        return installing
      },
      schedule() {
        const backend = input.major
        if (scheduling) return scheduling
        if (major.status === "scheduled") return Promise.resolve()
        if (!backend?.installOnQuit || major.status !== "ready")
          return Promise.reject(new Error("OpenCode 2 is not ready to install"))
        const offer = major
        transitionMajor({ status: "scheduling" })
        scheduling = backend
          .installOnQuit()
          .then(
            () => {
              transitionMajor({ status: "scheduled" })
            },
            (error) => {
              transitionMajor(offer)
              throw error
            },
          )
          .finally(() => {
            scheduling = undefined
          })
        return scheduling
      },
    },
  }
}

function isMajor(version: string | undefined) {
  return Number(version?.split(".")[0]) >= MAJOR_VERSION
}

export type UpdaterController = ReturnType<typeof createUpdaterController>

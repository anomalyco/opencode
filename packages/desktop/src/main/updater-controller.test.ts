import { describe, expect, test } from "bun:test"
import {
  createUpdaterController,
  type MajorUpdaterBackend,
  type UpdaterBackend,
  type UpdaterReadyRecord,
} from "./updater-controller"

function setup(input?: { currentVersion?: string; ready?: UpdaterReadyRecord }) {
  const calls: string[] = []
  const backend: UpdaterBackend = {
    async checkForUpdates() {
      calls.push("check")
      return { isUpdateAvailable: true, updateInfo: { version: "2.0.0" } }
    },
    async downloadUpdate() {
      calls.push("download")
    },
    quitAndInstall() {
      calls.push("install")
    },
  }
  let ready = input?.ready
  const controller = createUpdaterController({
    enabled: true,
    currentVersion: input?.currentVersion ?? "1.0.0",
    backend,
    persistence: {
      get: () => ready,
      set: (value) => {
        ready = value
      },
      clear: () => {
        ready = undefined
      },
    },
    stop: async () => {
      calls.push("stop")
    },
  })
  return { controller, calls, getReady: () => ready }
}

describe("updater controller", () => {
  test("checks, downloads, persists, and publishes one authoritative ready state", async () => {
    const app = setup()
    const states: ReturnType<typeof app.controller.getState>[] = []
    app.controller.subscribe((state) => states.push(state))

    await app.controller.start()

    expect(app.calls).toEqual(["check", "download"])
    expect(app.getReady()).toEqual({ version: "2.0.0" })
    expect(states.map((state) => state.status)).toEqual(["idle", "checking", "downloading", "ready"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("revalidates a persisted target through the updater cache on launch", async () => {
    const app = setup({ ready: { version: "2.0.0" } })

    await app.controller.start()

    expect(app.calls).toEqual(["check", "download"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("clears a target already installed before checking", async () => {
    const app = setup({ currentVersion: "2.0.0", ready: { version: "2.0.0" } })

    await app.controller.start()

    expect(app.getReady()).toBeUndefined()
    expect(app.calls).toEqual(["check"])
  })

  test("coalesces concurrent checks", async () => {
    const app = setup()

    await Promise.all([app.controller.check(), app.controller.check(), app.controller.check()])

    expect(app.calls).toEqual(["check", "download"])
  })

  test("returns to ready when quitAndInstall returns without exiting", async () => {
    const app = setup()
    await app.controller.start()

    await app.controller.install()

    expect(app.calls).toEqual(["check", "download", "stop", "install"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("returns to ready when installation cannot start", async () => {
    const app = setup()
    await app.controller.start()

    const failed = createUpdaterController({
      enabled: true,
      currentVersion: "1.0.0",
      backend: {
        checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: "2.0.0" } }),
        downloadUpdate: async () => {},
        quitAndInstall() {},
      },
      persistence: { get: () => undefined, set() {}, clear() {} },
      stop: async () => {
        throw new Error("stop failed")
      },
    })
    await failed.start()

    await expect(failed.install()).rejects.toThrow("stop failed")
    expect(failed.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })
})

function setupMajor(input?: { update?: () => boolean; major?: Partial<MajorUpdaterBackend> }) {
  const calls: string[] = []
  const controller = createUpdaterController({
    enabled: true,
    currentVersion: "1.19.5",
    backend: {
      async checkForUpdates() {
        calls.push("check")
        return { isUpdateAvailable: input?.update?.() ?? false, updateInfo: { version: "1.19.6" } }
      },
      async downloadUpdate() {
        calls.push("download")
      },
      quitAndInstall() {
        calls.push("install")
      },
    },
    major: {
      async checkForUpdates() {
        calls.push("major check")
        return { isUpdateAvailable: true, updateInfo: { version: "2.2.7" } }
      },
      async downloadUpdate() {
        calls.push("major download")
      },
      async installOnQuit() {
        calls.push("major install on quit")
      },
      quitAndInstall() {
        calls.push("major install")
      },
      ...input?.major,
    },
    persistence: { get: () => undefined, set() {}, clear() {} },
    stop: async () => {
      calls.push("stop")
    },
  })
  const states: string[] = []
  controller.major.subscribe((state) => states.push(state.status))
  // The background download is not awaited by a check, so tests wait for the offer to settle.
  const settled = async () => {
    for (const _ of Array.from({ length: 10 })) await Promise.resolve()
  }
  return { controller, calls, states, settled }
}

describe("major updater", () => {
  test("downloads OpenCode 2 once OpenCode 1 is up to date, then offers it", async () => {
    const app = setupMajor()

    await app.controller.start()
    await app.settled()

    expect(app.controller.getState()).toEqual({ status: "up-to-date" })
    expect(app.states).toEqual(["unavailable", "downloading", "ready"])
    expect(app.calls).toEqual(["check", "major check", "major download"])
  })

  test("installs nothing until the user chooses", async () => {
    const app = setupMajor()
    await app.controller.start()
    await app.settled()

    expect(app.calls).not.toContain("major install")
    expect(app.calls).not.toContain("major install on quit")
    expect(app.calls).not.toContain("stop")
  })

  test("a newer OpenCode 1 release comes first", async () => {
    const app = setupMajor({ update: () => true })

    await app.controller.start()
    await app.settled()

    expect(app.controller.getState()).toEqual({ status: "ready", version: "1.19.6" })
    expect(app.controller.major.getState()).toEqual({ status: "unavailable" })
    expect(app.calls).toEqual(["check", "download"])
    await expect(app.controller.major.restart()).rejects.toThrow("OpenCode 2 is not ready to install")
  })

  test("never offers OpenCode 2 without a feed for it", async () => {
    const controller = createUpdaterController({
      enabled: true,
      currentVersion: "1.19.5",
      backend: {
        checkForUpdates: async () => ({ isUpdateAvailable: false }),
        downloadUpdate: async () => {},
        quitAndInstall() {},
      },
      persistence: { get: () => undefined, set() {}, clear() {} },
      stop: async () => {},
    })

    await controller.start()

    expect(controller.major.getState()).toEqual({ status: "unavailable" })
  })

  test("restart stops the app and installs OpenCode 2", async () => {
    const app = setupMajor()
    await app.controller.start()
    await app.settled()

    await app.controller.major.restart()

    expect(app.calls).toEqual(["check", "major check", "major download", "stop", "major install"])
  })

  test("upgrade on quit arms the install and keeps the app running", async () => {
    const app = setupMajor()
    await app.controller.start()
    await app.settled()

    await app.controller.major.schedule()

    expect(app.states).toEqual(["unavailable", "downloading", "ready", "scheduled"])
    expect(app.calls).toEqual(["check", "major check", "major download", "major install on quit"])
  })

  test("restart still works after upgrade on quit was chosen", async () => {
    const app = setupMajor()
    await app.controller.start()
    await app.settled()
    await app.controller.major.schedule()

    await app.controller.major.restart()

    expect(app.calls.slice(-2)).toEqual(["stop", "major install"])
  })

  test("stops checking for OpenCode 1 releases once the user chose OpenCode 2", async () => {
    const app = setupMajor()
    await app.controller.start()
    await app.settled()
    await app.controller.major.schedule()

    await app.controller.check()

    expect(app.calls.filter((call) => call === "check")).toHaveLength(1)
  })

  test("a failed download stays quiet and the next check tries again", async () => {
    const failure = { fail: true }
    const app = setupMajor({
      major: {
        async downloadUpdate() {
          if (failure.fail) throw new Error("net::ERR_INTERNET_DISCONNECTED")
        },
      },
    })
    await app.controller.start()
    await app.settled()
    expect(app.states).toEqual(["unavailable", "downloading", "unavailable"])

    failure.fail = false
    await app.controller.check()
    await app.settled()

    expect(app.controller.major.getState()).toEqual({ status: "ready" })
  })

  test("stays unavailable when the feed has no OpenCode 2 release", async () => {
    const app = setupMajor({ major: { checkForUpdates: async () => ({ isUpdateAvailable: false }) } })

    await app.controller.start()
    await app.settled()

    expect(app.controller.major.getState()).toEqual({ status: "unavailable" })
  })

  test("a newer OpenCode 1 release withdraws an offer that was already made", async () => {
    const release = { out: false }
    const app = setupMajor({ update: () => release.out })
    await app.controller.start()
    await app.settled()
    expect(app.controller.major.getState()).toEqual({ status: "ready" })

    release.out = true
    await app.controller.check()

    expect(app.controller.getState()).toEqual({ status: "ready", version: "1.19.6" })
    expect(app.controller.major.getState()).toEqual({ status: "unavailable" })
  })

  test("upgrade on quit that cannot be armed leaves the offer as it was", async () => {
    const app = setupMajor({
      major: {
        async installOnQuit() {
          throw new Error("cache missing")
        },
      },
    })
    await app.controller.start()
    await app.settled()

    await expect(app.controller.major.schedule()).rejects.toThrow("cache missing")
    expect(app.controller.major.getState()).toEqual({ status: "ready" })
  })

  test("prompts in one window per launch", () => {
    const app = setupMajor()

    expect([app.controller.major.prompt(), app.controller.major.prompt()]).toEqual([true, false])
  })
})

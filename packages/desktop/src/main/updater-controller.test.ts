import { describe, expect, test } from "bun:test"
import { createUpdaterController, type UpdaterBackend, type UpdaterReadyRecord } from "./updater-controller"

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

function setupMajor(input?: { update?: boolean; major?: Partial<UpdaterBackend> }) {
  const calls: string[] = []
  const controller = createUpdaterController({
    enabled: true,
    currentVersion: "1.19.5",
    backend: {
      async checkForUpdates() {
        calls.push("check")
        return { isUpdateAvailable: input?.update ?? false, updateInfo: { version: "1.19.6" } }
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
  return { controller, calls }
}

describe("major updater", () => {
  test("offers OpenCode 2 once OpenCode 1 is up to date, without downloading it", async () => {
    const app = setupMajor()

    await app.controller.start()

    expect(app.controller.getState()).toEqual({ status: "up-to-date" })
    expect(app.controller.major.getState()).toEqual({ status: "available" })
    expect(app.calls).toEqual(["check"])
  })

  test("a newer OpenCode 1 release wins over the OpenCode 2 offer", async () => {
    const app = setupMajor({ update: true })

    await app.controller.start()

    expect(app.controller.getState()).toEqual({ status: "ready", version: "1.19.6" })
    expect(app.controller.major.getState()).toEqual({ status: "unavailable" })
    await app.controller.major.install()
    expect(app.calls).toEqual(["check", "download"])
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

  test("upgrades when asked, then installs on restart", async () => {
    const app = setupMajor()
    await app.controller.start()
    const states: string[] = []
    app.controller.major.subscribe((state) => states.push(state.status))

    await app.controller.major.install()
    await app.controller.major.restart()

    expect(states).toEqual(["available", "installing", "installed"])
    expect(app.calls).toEqual(["check", "major check", "major download", "stop", "major install"])
  })

  test("stops checking for OpenCode 1 releases once OpenCode 2 is downloaded", async () => {
    const app = setupMajor()
    await app.controller.start()
    await app.controller.major.install()

    await app.controller.check()

    expect(app.calls).toEqual(["check", "major check", "major download"])
  })

  test("reports a failed download and lets the user try again", async () => {
    const failure = { fail: true }
    const app = setupMajor({
      major: {
        async downloadUpdate() {
          if (failure.fail) throw new Error("net::ERR_INTERNET_DISCONNECTED")
        },
      },
    })
    await app.controller.start()

    await app.controller.major.install()
    expect(app.controller.major.getState()).toEqual({ status: "failed", message: "net::ERR_INTERNET_DISCONNECTED" })
    await expect(app.controller.major.restart()).rejects.toThrow("OpenCode 2 is not ready to install")

    failure.fail = false
    await app.controller.major.install()
    expect(app.controller.major.getState()).toEqual({ status: "installed" })
  })

  test("fails without a message when the feed has no OpenCode 2 release", async () => {
    const app = setupMajor({ major: { checkForUpdates: async () => ({ isUpdateAvailable: false }) } })
    await app.controller.start()

    await app.controller.major.install()

    expect(app.controller.major.getState()).toEqual({ status: "failed" })
  })

  test("prompts in one window per launch", () => {
    const app = setupMajor()

    expect([app.controller.major.prompt(), app.controller.major.prompt()]).toEqual([true, false])
  })
})

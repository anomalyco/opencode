import { describe, expect, test } from "bun:test"
import { createUpdaterController, type UpdaterPlatform, type UpdaterReadyRecord } from "./updater-controller"

function setup(input?: { currentVersion?: string; ready?: UpdaterReadyRecord }) {
  const calls: string[] = []
  const platform: UpdaterPlatform = {
    async checkForUpdate() {
      calls.push("check")
      return { isUpdateAvailable: true, updateInfo: { version: "2.0.0" } }
    },
    async stageUpdate() {
      calls.push("download")
    },
    installAndRestart() {
      calls.push("install")
      return new Promise<never>(() => {})
    },
  }
  let ready = input?.ready
  const controller = createUpdaterController({
    enabled: true,
    currentVersion: input?.currentVersion ?? "1.0.0",
    platform,
    persistence: {
      get: () => ready,
      set: (value) => {
        ready = value
      },
      clear: () => {
        ready = undefined
      },
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

  test("starts installing synchronously and coalesces restart requests", async () => {
    const app = setup()
    await app.controller.start()

    const first = app.controller.install()
    const second = app.controller.install()

    expect(first).toBe(second)
    expect(app.calls).toEqual(["check", "download", "install"])
    expect(app.controller.getState()).toEqual({ status: "installing", version: "2.0.0" })
  })

  test("does not check for updates while installation is in progress", async () => {
    const app = setup()
    await app.controller.start()
    void app.controller.install()

    await app.controller.check()

    expect(app.calls).toEqual(["check", "download", "install"])
    expect(app.controller.getState()).toEqual({ status: "installing", version: "2.0.0" })
  })

  test("returns to ready when installation fails", async () => {
    const app = setup()
    await app.controller.start()
    const error = new Error("install failed")
    const failed = createUpdaterController({
      enabled: true,
      currentVersion: "1.0.0",
      platform: {
        checkForUpdate: async () => ({ isUpdateAvailable: true, updateInfo: { version: "2.0.0" } }),
        stageUpdate: async () => {},
        installAndRestart: () => Promise.reject(error),
      },
      persistence: { get: () => undefined, set() {}, clear() {} },
    })
    await failed.start()

    await expect(failed.install()).rejects.toThrow("install failed")
    expect(failed.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })
})

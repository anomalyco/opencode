import { describe, expect, test } from "bun:test"
import { createUpdaterController, type UpdaterReadyRecord } from "./controller"

// Drives the controller the way the app does: start or check, observe the states
// the renderer sees, then install like a button click. `calls` records the platform
// operations in order; installs record the staged version they would apply.
function setup(input?: {
  currentVersion?: string
  ready?: UpdaterReadyRecord
  latest?: () => string
  stage?: () => Promise<void>
  install?: () => Promise<never>
}) {
  const calls: string[] = []
  const states: string[] = []
  let ready = input?.ready
  const controller = createUpdaterController({
    currentVersion: input?.currentVersion ?? "1.0.0",
    platform: {
      async checkForUpdate() {
        calls.push("check")
        return input?.latest?.() ?? "2.0.0"
      },
      async stageUpdate() {
        calls.push("download")
        await input?.stage?.()
      },
      installAndRestart() {
        calls.push(`install:${ready?.version}`)
        return input?.install?.() ?? new Promise<never>(() => {})
      },
    },
    lifecycle: {
      async prepareToRestart() {
        calls.push("prepare")
      },
    },
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
  controller.subscribe((state) => states.push(state.status))
  return { controller, calls, states, getReady: () => ready }
}

describe("updater controller", () => {
  test("stages an update found at launch and shows it as ready", async () => {
    const app = setup()

    await app.controller.start()

    expect(app.states).toEqual(["idle", "checking", "downloading", "ready"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
    expect(app.getReady()).toEqual({ version: "2.0.0" })
  })

  test("reports up to date and clears the record once the update is installed", async () => {
    const app = setup({ currentVersion: "2.0.0", ready: { version: "2.0.0" } })

    await app.controller.start()

    expect(app.states).toEqual(["idle", "checking", "up-to-date"])
    expect(app.calls).toEqual(["check"])
    expect(app.getReady()).toBeUndefined()
  })

  test("revalidates a persisted target through the updater cache on launch", async () => {
    const app = setup({ ready: { version: "2.0.0" } })

    await app.controller.start()

    expect(app.calls).toEqual(["check", "download"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("concurrent checks share one platform check", async () => {
    const app = setup()

    await Promise.all([app.controller.check(), app.controller.check(), app.controller.check()])

    expect(app.calls).toEqual(["check", "download"])
  })

  test("clicking install twice checks once and installs the staged version once", async () => {
    const app = setup()
    await app.controller.start()

    void app.controller.install()
    void app.controller.install()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(app.calls).toEqual(["check", "download", "check", "prepare", "install:2.0.0"])
    expect(app.controller.getState()).toEqual({ status: "installing", version: "2.0.0" })
  })

  test("ignores checks while an installation is in progress", async () => {
    const app = setup()
    await app.controller.start()
    void app.controller.install()

    await app.controller.check()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(app.calls).toEqual(["check", "download", "check", "prepare", "install:2.0.0"])
  })

  test("clicking install downloads and installs a newer release", async () => {
    let latest = "2.0.0"
    const app = setup({ latest: () => latest })
    await app.controller.start()

    latest = "3.0.0"
    void app.controller.install()

    expect(app.controller.getState()).toEqual({ status: "installing", version: "2.0.0" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(app.calls).toEqual(["check", "download", "check", "download", "prepare", "install:3.0.0"])
    expect(app.controller.getState()).toEqual({ status: "installing", version: "3.0.0" })
  })

  test("clicking install uses the staged release when the final check fails", async () => {
    let offline = false
    const app = setup({
      latest: () => {
        if (offline) throw new Error("offline")
        return "2.0.0"
      },
    })
    await app.controller.start()

    offline = true
    void app.controller.install()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(app.calls).toEqual(["check", "download", "check", "prepare", "install:2.0.0"])
    expect(app.controller.getState()).toEqual({ status: "installing", version: "2.0.0" })
  })

  test("later checks stay silent while ready and pick up newer versions", async () => {
    let latest = "2.0.0"
    const app = setup({ latest: () => latest })
    await app.controller.start()

    await app.controller.check()
    // Nothing new was published: the install button never hid.
    expect(app.states).toEqual(["idle", "checking", "downloading", "ready"])

    latest = "3.0.0"
    await app.controller.check()
    expect(app.states).toEqual(["idle", "checking", "downloading", "ready", "ready"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "3.0.0" })
    expect(app.getReady()).toEqual({ version: "3.0.0" })
  })

  test("keeps the staged update installable when a silent re-check fails", async () => {
    let offline = false
    const app = setup({
      latest: () => {
        if (offline) throw new Error("offline")
        return "2.0.0"
      },
    })
    await app.controller.start()

    offline = true
    await app.controller.check()

    expect(app.states).toEqual(["idle", "checking", "downloading", "ready"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
    expect(app.getReady()).toEqual({ version: "2.0.0" })
  })

  test("install during a silent refresh waits for the download, then installs the newer version", async () => {
    let latest = "2.0.0"
    let slowStage = false
    let releaseStage = () => {}
    const app = setup({
      latest: () => latest,
      stage: () => {
        if (!slowStage) return Promise.resolve()
        return new Promise<void>((resolve) => {
          releaseStage = resolve
        })
      },
    })
    await app.controller.start()

    latest = "3.0.0"
    slowStage = true
    const refresh = app.controller.check()
    await new Promise((resolve) => setTimeout(resolve, 0))

    void app.controller.install()
    expect(app.controller.getState()).toEqual({ status: "installing", version: "2.0.0" })

    releaseStage()
    await refresh
    expect(app.controller.getState()).toEqual({ status: "installing", version: "3.0.0" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(app.calls).toEqual(["check", "download", "check", "download", "prepare", "install:3.0.0"])
  })

  test("returns to ready after a failed installation and allows a retry", async () => {
    let attempts = 0
    const app = setup({
      install() {
        attempts++
        if (attempts === 1) return Promise.reject(new Error("install failed"))
        return new Promise<never>(() => {})
      },
    })
    await app.controller.start()

    await expect(app.controller.install()).rejects.toThrow("install failed")
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })

    void app.controller.install()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(attempts).toBe(2)
    expect(app.controller.getState()).toEqual({ status: "installing", version: "2.0.0" })
  })
})

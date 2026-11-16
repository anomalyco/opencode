import { describe, expect, test } from "bun:test"
import {
  createUpdaterController,
  LAUNCH_WINDOW,
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

type MajorFeed = { isUpdateAvailable?: boolean; updateInfo?: { version?: string } }

// Every fake records its call first. A hook then decides how the call ends, so a test can hold a call open with a
// deferred promise and settle it later.
function setupMajor(input?: {
  update?: () => boolean
  check?: () => Promise<unknown> | undefined
  feed?: () => MajorFeed | Promise<MajorFeed>
  download?: () => Promise<unknown>
  stage?: () => Promise<boolean>
  installOnQuit?: () => Promise<unknown>
  // A package that cannot install while the app quits.
  restartOnly?: boolean
  quitAndInstall?: () => void
  stop?: () => Promise<void>
  now?: () => number
}) {
  const calls: string[] = []
  const major: MajorUpdaterBackend = {
    async checkForUpdates() {
      calls.push("major check")
      return (await input?.feed?.()) ?? { isUpdateAvailable: true, updateInfo: { version: "2.2.7" } }
    },
    async downloadUpdate() {
      calls.push("major download")
      await input?.download?.()
    },
    cancelDownload() {
      calls.push("major cancel")
    },
    async stage() {
      calls.push("major stage")
      return (await input?.stage?.()) ?? false
    },
    async installOnQuit() {
      calls.push("major install on quit")
      await input?.installOnQuit?.()
    },
    disarm() {
      calls.push("major disarm")
    },
    quitAndInstall() {
      calls.push("major install")
      input?.quitAndInstall?.()
    },
  }
  const controller = createUpdaterController({
    enabled: true,
    currentVersion: "1.19.5",
    backend: {
      async checkForUpdates() {
        calls.push("check")
        await input?.check?.()
        return { isUpdateAvailable: input?.update?.() ?? false, updateInfo: { version: "1.19.6" } }
      },
      async downloadUpdate() {
        calls.push("download")
      },
      quitAndInstall() {
        calls.push("install")
      },
    },
    major: input?.restartOnly ? { ...major, installOnQuit: undefined } : major,
    persistence: { get: () => undefined, set() {}, clear() {} },
    stop: async () => {
      calls.push("stop")
      await input?.stop?.()
    },
    now: input?.now,
  })
  const states: string[] = []
  controller.major.subscribe((state) => states.push(state.status))
  const updates: string[] = []
  controller.subscribe((state) => updates.push(state.status))
  // The background download is not awaited by a check, so tests wait for the offer to settle.
  const settled = async () => {
    for (const _ of Array.from({ length: 20 })) await Promise.resolve()
  }
  // Starts the app with OpenCode 1 up to date and OpenCode 2 downloaded.
  const offer = async () => {
    await controller.start()
    await settled()
  }
  return { controller, calls, states, updates, settled, offer }
}

describe("major updater", () => {
  test("downloads OpenCode 2 once OpenCode 1 is up to date, then offers it", async () => {
    const app = setupMajor()

    await app.offer()

    expect(app.controller.getState()).toEqual({ status: "up-to-date" })
    expect(app.controller.major.getState()).toEqual({ status: "ready", quit: true })
    expect(app.states).toEqual(["unavailable", "downloading", "ready"])
    expect(app.calls).toEqual(["check", "major check", "major download"])
  })

  test("installs nothing until the user chooses", async () => {
    const app = setupMajor()
    await app.offer()

    expect(app.calls).not.toContain("major install")
    expect(app.calls).not.toContain("major install on quit")
    expect(app.calls).not.toContain("major stage")
    expect(app.calls).not.toContain("stop")
  })

  test("a newer OpenCode 1 release comes first", async () => {
    const app = setupMajor({ update: () => true })

    await app.offer()

    expect(app.controller.getState()).toEqual({ status: "ready", version: "1.19.6" })
    expect(app.controller.major.getState()).toEqual({ status: "unavailable" })
    expect(app.calls).toEqual(["check", "download"])
    await expect(app.controller.major.restart()).rejects.toThrow("OpenCode 2 is not ready to install")
    await expect(app.controller.major.schedule()).rejects.toThrow("OpenCode 2 is not ready to install")
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

  test("a failed download stays quiet and the next check tries again", async () => {
    const failure = { fail: true }
    const app = setupMajor({
      download: async () => {
        if (failure.fail) throw new Error("net::ERR_INTERNET_DISCONNECTED")
      },
    })
    await app.offer()
    expect(app.states).toEqual(["unavailable", "downloading", "unavailable"])
    expect(app.updates).not.toContain("error")

    failure.fail = false
    await app.controller.check()
    await app.settled()

    expect(app.controller.major.getState()).toEqual({ status: "ready", quit: true })
  })

  test("stays unavailable when the feed has no OpenCode 2 release", async () => {
    const app = setupMajor({ feed: () => ({ isUpdateAvailable: false }) })

    await app.offer()

    expect(app.controller.major.getState()).toEqual({ status: "unavailable" })
  })

  test("never offers a release older than OpenCode 2", async () => {
    const feed = { version: "1.20.0" as string | undefined }
    const app = setupMajor({ feed: () => ({ isUpdateAvailable: true, updateInfo: { version: feed.version } }) })

    await app.offer()
    feed.version = "0.9.0"
    await app.controller.check()
    await app.settled()
    feed.version = undefined
    await app.controller.check()
    await app.settled()

    expect(app.controller.major.getState()).toEqual({ status: "unavailable" })
    expect(app.calls).not.toContain("major download")

    feed.version = "3.0.0"
    await app.controller.check()
    await app.settled()

    expect(app.controller.major.getState()).toEqual({ status: "ready", quit: true })
  })

  test("offers a restart only where OpenCode 2 cannot install while the app quits", async () => {
    const app = setupMajor({ restartOnly: true })

    await app.offer()

    expect(app.controller.major.getState()).toEqual({ status: "ready", quit: false })
    await expect(app.controller.major.schedule()).rejects.toThrow("OpenCode 2 is not ready to install")
    expect(app.controller.major.getState()).toEqual({ status: "ready", quit: false })
  })
})

describe("major updater and OpenCode 1 releases", () => {
  test("a newer OpenCode 1 release withdraws an offer that was already made", async () => {
    const release = { out: false }
    const app = setupMajor({ update: () => release.out })
    await app.offer()
    expect(app.controller.major.getState()).toEqual({ status: "ready", quit: true })

    release.out = true
    await app.controller.check()

    expect(app.controller.getState()).toEqual({ status: "ready", version: "1.19.6" })
    expect(app.controller.major.getState()).toEqual({ status: "unavailable" })
    expect(app.calls.slice(-3)).toEqual(["major cancel", "major disarm", "download"])
  })

  test("an OpenCode 1 release found while OpenCode 2 downloads cancels it and waits for it to end", async () => {
    const download = Promise.withResolvers<void>()
    const release = { out: false }
    const app = setupMajor({ update: () => release.out, download: () => download.promise })
    await app.offer()
    expect(app.controller.major.getState()).toEqual({ status: "downloading" })

    release.out = true
    const checking = app.controller.check()
    await app.settled()

    // Both updaters share the system updater on macOS, so the OpenCode 1 download must not start yet.
    expect(app.calls).toEqual(["check", "major check", "major download", "check", "major cancel", "major disarm"])
    expect(app.controller.getState()).toEqual({ status: "checking" })
    expect(app.controller.major.getState()).toEqual({ status: "unavailable" })

    download.reject(new Error("cancelled"))
    await checking
    await app.settled()

    expect(app.calls.slice(-1)).toEqual(["download"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "1.19.6" })
    expect(app.controller.major.getState()).toEqual({ status: "unavailable" })
    expect(app.updates).not.toContain("error")
    expect(app.states).toEqual(["unavailable", "downloading", "unavailable"])
  })

  test("an OpenCode 2 download that finishes after it was withdrawn is not offered", async () => {
    const download = Promise.withResolvers<void>()
    const release = { out: false }
    const app = setupMajor({ update: () => release.out, download: () => download.promise })
    await app.offer()

    release.out = true
    const checking = app.controller.check()
    await app.settled()
    download.resolve()
    await checking
    await app.settled()

    expect(app.controller.getState()).toEqual({ status: "ready", version: "1.19.6" })
    expect(app.controller.major.getState()).toEqual({ status: "unavailable" })
    await expect(app.controller.major.restart()).rejects.toThrow("OpenCode 2 is not ready to install")
  })

  test("an OpenCode 1 release found while the OpenCode 2 feed answers stops the download before it starts", async () => {
    const answer = Promise.withResolvers<{ isUpdateAvailable: boolean; updateInfo: { version: string } }>()
    const release = { out: false }
    const app = setupMajor({ update: () => release.out, feed: () => answer.promise })
    await app.offer()
    expect(app.controller.major.getState()).toEqual({ status: "downloading" })

    release.out = true
    const checking = app.controller.check()
    await app.settled()
    expect(app.calls).toEqual(["check", "major check", "check", "major cancel", "major disarm"])

    answer.resolve({ isUpdateAvailable: true, updateInfo: { version: "2.2.7" } })
    await checking

    expect(app.calls).not.toContain("major download")
    expect(app.calls.slice(-1)).toEqual(["download"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "1.19.6" })
    expect(app.controller.major.getState()).toEqual({ status: "unavailable" })
  })

  test("upgrade on quit chosen while a check is in flight keeps an OpenCode 1 release from downloading", async () => {
    const answer = Promise.withResolvers<void>()
    const release = { out: false }
    const app = setupMajor({ update: () => release.out, check: () => (release.out ? answer.promise : undefined) })
    await app.offer()

    release.out = true
    const checking = app.controller.check()
    await app.controller.major.schedule()
    answer.resolve()
    await checking

    expect(app.controller.getState()).toEqual({ status: "idle" })
    expect(app.controller.major.getState()).toEqual({ status: "scheduled" })
    expect(app.calls).not.toContain("download")
    expect(app.calls).not.toContain("major disarm")
  })

  test("an OpenCode 1 release found while upgrade on quit is still being armed does not download", async () => {
    const answer = Promise.withResolvers<void>()
    const armed = Promise.withResolvers<void>()
    const release = { out: false }
    const app = setupMajor({
      update: () => release.out,
      check: () => (release.out ? answer.promise : undefined),
      installOnQuit: () => armed.promise,
    })
    await app.offer()

    release.out = true
    const checking = app.controller.check()
    const scheduling = app.controller.major.schedule()
    answer.resolve()
    await checking
    expect(app.controller.major.getState()).toEqual({ status: "scheduling" })
    armed.resolve()
    await scheduling

    expect(app.controller.major.getState()).toEqual({ status: "scheduled" })
    expect(app.calls).not.toContain("download")
  })

  test("stops checking for OpenCode 1 releases once the user chose OpenCode 2", async () => {
    const app = setupMajor()
    await app.offer()
    await app.controller.major.schedule()

    await app.controller.check()

    expect(app.calls.filter((call) => call === "check")).toHaveLength(1)
  })

  test("a check the user asked for waits for OpenCode 2 to download", async () => {
    const download = Promise.withResolvers<void>()
    const app = setupMajor({ download: () => download.promise })
    const answered: string[] = []

    const checking = app.controller.checkNow().then((state) => answered.push(state.status))
    await app.settled()

    expect(app.controller.getState()).toEqual({ status: "up-to-date" })
    expect(app.controller.major.getState()).toEqual({ status: "downloading" })
    expect(answered).toEqual([])

    download.resolve()
    await checking

    expect(answered).toEqual(["up-to-date"])
    expect(app.controller.major.getState()).toEqual({ status: "ready", quit: true })
  })
})

describe("major updater upgrade on quit", () => {
  test("arms the install and keeps the app running", async () => {
    const app = setupMajor()
    await app.offer()

    await app.controller.major.schedule()

    expect(app.states).toEqual(["unavailable", "downloading", "ready", "scheduling", "scheduled"])
    expect(app.calls).toEqual(["check", "major check", "major download", "major install on quit"])
  })

  test("that cannot be armed leaves the offer as it was", async () => {
    const app = setupMajor({
      installOnQuit: async () => {
        throw new Error("cache missing")
      },
    })
    await app.offer()

    await expect(app.controller.major.schedule()).rejects.toThrow("cache missing")
    expect(app.controller.major.getState()).toEqual({ status: "ready", quit: true })
  })

  test("is armed once when chosen twice", async () => {
    const armed = Promise.withResolvers<void>()
    const app = setupMajor({ installOnQuit: () => armed.promise })
    await app.offer()

    const first = app.controller.major.schedule()
    const second = app.controller.major.schedule()
    armed.resolve()
    await Promise.all([first, second])
    await app.controller.major.schedule()

    expect(app.calls.filter((call) => call === "major install on quit")).toHaveLength(1)
    expect(app.controller.major.getState()).toEqual({ status: "scheduled" })
  })
})

describe("major updater restart", () => {
  test("stages OpenCode 2, stops the app and installs", async () => {
    const app = setupMajor()
    await app.offer()

    await app.controller.major.restart()

    expect(app.calls).toEqual(["check", "major check", "major download", "major stage", "stop", "major install"])
    expect(app.controller.major.getState()).toEqual({ status: "installing" })
  })

  test("still works after upgrade on quit was chosen, without staging again", async () => {
    const app = setupMajor()
    await app.offer()
    await app.controller.major.schedule()

    await app.controller.major.restart()

    expect(app.calls.slice(-3)).toEqual(["major install on quit", "stop", "major install"])
  })

  test("called twice starts the installer once", async () => {
    const stopped = Promise.withResolvers<void>()
    const app = setupMajor({ stop: () => stopped.promise })
    await app.offer()

    const first = app.controller.major.restart()
    const second = app.controller.major.restart()
    expect(app.controller.major.getState()).toEqual({ status: "installing" })
    stopped.resolve()
    await Promise.all([first, second])
    await app.controller.major.restart()

    expect(second).toBe(first)
    expect(app.calls.filter((call) => call === "stop")).toHaveLength(1)
    expect(app.calls.filter((call) => call === "major install")).toHaveLength(1)
    expect(app.controller.major.getState()).toEqual({ status: "installing" })
  })

  test("keeps the servers running when OpenCode 2 cannot be staged", async () => {
    const app = setupMajor({
      stage: async () => {
        throw new Error("Code signature did not pass validation")
      },
    })
    await app.offer()

    await expect(app.controller.major.restart()).rejects.toThrow("Code signature did not pass validation")

    expect(app.calls).not.toContain("stop")
    expect(app.calls).not.toContain("major install")
    expect(app.controller.major.getState()).toEqual({ status: "ready", quit: true })
  })

  test("returns to the offer and says the servers are stopped when stopping them fails", async () => {
    const app = setupMajor({
      stop: async () => {
        throw new Error("stop failed")
      },
    })
    await app.offer()

    await expect(app.controller.major.restart()).rejects.toThrow("stop failed")

    expect(app.calls).not.toContain("major install")
    expect(app.controller.major.getState()).toEqual({ status: "ready", quit: true, stopped: true })
  })

  test("returns to the offer when the installer cannot start, and can try again", async () => {
    const failure = { fail: true }
    const app = setupMajor({
      quitAndInstall: () => {
        if (failure.fail) throw new Error("No update filepath provided, can't quit and install")
      },
    })
    await app.offer()

    await expect(app.controller.major.restart()).rejects.toThrow("No update filepath provided")
    expect(app.controller.major.getState()).toEqual({ status: "ready", quit: true, stopped: true })

    failure.fail = false
    await app.controller.major.restart()

    expect(app.calls.filter((call) => call === "major install")).toHaveLength(2)
    expect(app.controller.major.getState()).toEqual({ status: "installing" })
  })

  test("stays armed for the next quit when staging cannot be taken back", async () => {
    const app = setupMajor({
      stage: async () => true,
      stop: async () => {
        throw new Error("stop failed")
      },
    })
    await app.offer()

    await expect(app.controller.major.restart()).rejects.toThrow("stop failed")

    expect(app.controller.major.getState()).toEqual({ status: "scheduled", stopped: true })
  })

  test("that fails after upgrade on quit was chosen keeps the install armed", async () => {
    const app = setupMajor({
      quitAndInstall: () => {
        throw new Error("installer missing")
      },
    })
    await app.offer()
    await app.controller.major.schedule()

    await expect(app.controller.major.restart()).rejects.toThrow("installer missing")

    expect(app.controller.major.getState()).toEqual({ status: "scheduled", stopped: true })
    expect(app.calls).not.toContain("major disarm")
  })
})

describe("major updater prompt", () => {
  test("opens the offer in one window per launch", async () => {
    const app = setupMajor({ now: () => 0 })
    await app.offer()

    expect([app.controller.major.prompt(), app.controller.major.prompt()]).toEqual(["launch", undefined])
  })

  test("measures the launch window once for the whole app, not for each window", async () => {
    const clock = { now: 1000 }
    const app = setupMajor({ now: () => clock.now })
    await app.offer()

    // The download took longer than the launch window. A window that opens or reloads hours later asks again.
    clock.now = 1000 + LAUNCH_WINDOW + 1
    expect(app.controller.major.prompt()).toBeUndefined()
    clock.now = 1000 + 6 * 60 * 60 * 1000
    expect(app.controller.major.prompt()).toBeUndefined()
  })

  test("still opens at the very end of the launch window", async () => {
    const clock = { now: 1000 }
    const app = setupMajor({ now: () => clock.now })
    await app.offer()

    clock.now = 1000 + LAUNCH_WINDOW
    expect(app.controller.major.prompt()).toBe("launch")
  })

  test("opens the offer the user asked for in the next window, whenever that is", async () => {
    const clock = { now: 0 }
    const app = setupMajor({ now: () => clock.now })
    await app.offer()
    clock.now = LAUNCH_WINDOW * 100

    app.controller.major.ask()

    expect([app.controller.major.prompt(), app.controller.major.prompt()]).toEqual(["asked", undefined])
  })

  test("forgets what the user asked for when the offer is withdrawn", async () => {
    const release = { out: false }
    const clock = { now: 0 }
    const app = setupMajor({ update: () => release.out, now: () => clock.now })
    await app.offer()
    clock.now = LAUNCH_WINDOW * 100
    app.controller.major.ask()

    release.out = true
    await app.controller.check()

    expect(app.controller.major.prompt()).toBeUndefined()
  })
})

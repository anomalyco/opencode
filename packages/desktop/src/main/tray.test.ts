import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"

let setupTrayAndLifecycle: () => void

type MenuItem = { label?: string; type?: string; click?: () => void }

const state = {
  activateHandler: undefined as undefined | (() => void),
  trayClickHandler: undefined as undefined | (() => void),
  menu: undefined as undefined | MenuItem[],
  trayCreated: 0,
  quitCalls: 0,
  showCalls: 0,
}

beforeAll(async () => {
  const api = {
    app: {
      on: (event: string, handler: () => void) => {
        if (event === "activate") state.activateHandler = handler
      },
      quit: () => {
        state.quitCalls++
      },
      // store.ts (a transitive importer in the same process) reads userData.
      getPath: () => "/tmp/opencode-test-userdata",
    },
    Menu: {
      buildFromTemplate: (template: MenuItem[]) => {
        state.menu = template
        return template
      },
    },
    nativeImage: {
      createFromPath: () => ({}),
    },
    Tray: function Tray() {
      state.trayCreated++
      return {
        setToolTip: () => {},
        setContextMenu: () => {},
        on: (event: string, handler: () => void) => {
          if (event === "click") state.trayClickHandler = handler
        },
      }
    },
  }
  // Expose the API as the default export too, so modules that do
  // `import electron from "electron"` (e.g. store.ts) resolve correctly under the mock.
  mock.module("electron", () => ({ ...api, default: api }))
  mock.module("./windows", () => ({
    iconPath: () => "/fake/icon.png",
    showMainWindow: () => {
      state.showCalls++
    },
  }))
  const mod = await import("./tray")
  setupTrayAndLifecycle = mod.setupTrayAndLifecycle
})

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
}

beforeEach(() => {
  state.activateHandler = undefined
  state.trayClickHandler = undefined
  state.menu = undefined
  state.trayCreated = 0
  state.quitCalls = 0
  state.showCalls = 0
  setPlatform("linux")
})

describe("tray lifecycle", () => {
  test("restores the window when the app is activated", () => {
    setupTrayAndLifecycle()
    expect(state.activateHandler).toBeDefined()
    state.activateHandler?.()
    expect(state.showCalls).toBe(1)
  })

  test("creates a tray with Show and Quit entries on linux", () => {
    setupTrayAndLifecycle()
    expect(state.trayCreated).toBe(1)
    const labels = state.menu?.map((item) => item.label ?? item.type)
    expect(labels).toEqual(["Show OpenCode", "separator", "Quit"])
  })

  test("tray click and Show entry both restore the window", () => {
    setupTrayAndLifecycle()
    state.trayClickHandler?.()
    const showEntry = state.menu?.find((item) => item.label === "Show OpenCode")
    showEntry?.click?.()
    expect(state.showCalls).toBe(2)
  })

  test("tray Quit entry quits the app", () => {
    setupTrayAndLifecycle()
    const quitEntry = state.menu?.find((item) => item.label === "Quit")
    quitEntry?.click?.()
    expect(state.quitCalls).toBe(1)
  })

  test("does not create a tray on macOS but still wires activate", () => {
    setPlatform("darwin")
    setupTrayAndLifecycle()
    expect(state.trayCreated).toBe(0)
    expect(state.activateHandler).toBeDefined()
  })
})

afterAll(() => {
  setPlatform(originalPlatform)
  // Restore mocked modules so the electron mock does not leak into other test
  // files that import electron transitively in the same process.
  mock.restore()
})

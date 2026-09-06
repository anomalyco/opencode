import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"

let createTray: (iconPath: string, onShow: () => void) => unknown
let destroyTray: () => void

const state = {
  trayCreated: 0,
  trayDestroyed: 0,
  toolTip: "",
  menu: undefined as undefined | { label?: string; type?: string; click?: () => void }[],
  clickHandler: undefined as undefined | (() => void),
  doubleClickHandler: undefined as undefined | (() => void),
  quitCalls: 0,
}

beforeAll(async () => {
  const api = {
    app: {
      quit: () => {
        state.quitCalls++
      },
    },
    Menu: {
      buildFromTemplate: (template: { label?: string; type?: string; click?: () => void }[]) => {
        state.menu = template
        return template
      },
    },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => false }),
    },
    Tray: function Tray() {
      state.trayCreated++
      return {
        setToolTip: (tip: string) => {
          state.toolTip = tip
        },
        setContextMenu: () => {},
        on: (event: string, handler: () => void) => {
          if (event === "click") state.clickHandler = handler
          if (event === "double-click") state.doubleClickHandler = handler
        },
        destroy: () => {
          state.trayDestroyed++
        },
      }
    },
  }
  mock.module("electron", () => ({ ...api, default: api }))
  const mod = await import("./tray")
  createTray = mod.createTray
  destroyTray = mod.destroyTray
})

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
}

beforeEach(() => {
  // Reset the module-level tray singleton so every test starts clean;
  // otherwise the idempotent createTray returns the instance created by an
  // earlier test and no new Tray is constructed.
  destroyTray()
  state.trayCreated = 0
  state.trayDestroyed = 0
  state.toolTip = ""
  state.menu = undefined
  state.clickHandler = undefined
  state.doubleClickHandler = undefined
  state.quitCalls = 0
  setPlatform("win32")
})

afterAll(() => {
  setPlatform(originalPlatform)
  mock.restore()
})

describe("tray", () => {
  test("creates a tray with Show and Quit entries on windows", () => {
    const tray = createTray("/fake/icon.ico", () => {})
    expect(tray).toBeDefined()
    expect(state.trayCreated).toBe(1)
    expect(state.toolTip).toBe("OpenCode")
    const labels = state.menu?.map((item) => item.label ?? item.type)
    expect(labels).toEqual(["Show OpenCode", "separator", "Quit"])
  })

  test("is idempotent: creating again returns the same instance", () => {
    createTray("/fake/icon.ico", () => {})
    createTray("/fake/icon.ico", () => {})
    expect(state.trayCreated).toBe(1)
  })

  test("single and double click both restore the window", () => {
    const show = mock(() => {})
    createTray("/fake/icon.ico", show)
    state.clickHandler?.()
    state.doubleClickHandler?.()
    expect(show).toHaveBeenCalledTimes(2)
  })

  test("tray Show entry restores the window", () => {
    const show = mock(() => {})
    createTray("/fake/icon.ico", show)
    const showEntry = state.menu?.find((item) => item.label === "Show OpenCode")
    showEntry?.click?.()
    expect(show).toHaveBeenCalledTimes(1)
  })

  test("tray Quit entry quits the app", () => {
    createTray("/fake/icon.ico", () => {})
    const quitEntry = state.menu?.find((item) => item.label === "Quit")
    quitEntry?.click?.()
    expect(state.quitCalls).toBe(1)
  })

  test("does not create a tray on macOS", () => {
    setPlatform("darwin")
    expect(createTray("/fake/icon.png", () => {})).toBeUndefined()
    expect(state.trayCreated).toBe(0)
  })

  test("destroy removes the tray instance", () => {
    createTray("/fake/icon.ico", () => {})
    destroyTray()
    expect(state.trayDestroyed).toBe(1)
    // A destroyed tray can be recreated.
    createTray("/fake/icon.ico", () => {})
    expect(state.trayCreated).toBe(2)
  })
})

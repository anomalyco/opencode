import { describe, expect, test, vi, beforeEach } from "vitest"

const menuItems: Array<Record<string, unknown>> = []

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: {
    new: vi.fn(async () => ({
      setAsAppMenu: vi.fn(),
    })),
  },
  MenuItem: {
    new: vi.fn(async (opts: Record<string, unknown>) => {
      menuItems.push(opts)
      return opts
    }),
  },
  PredefinedMenuItem: {
    new: vi.fn(async (opts: Record<string, unknown>) => opts),
  },
  Submenu: {
    new: vi.fn(async (opts: Record<string, unknown>) => opts),
  },
}))

vi.mock("@tauri-apps/plugin-os", () => ({
  type: () => "macos",
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}))

vi.mock("./updater", () => ({
  UPDATER_ENABLED: false,
  runUpdater: vi.fn(),
}))

vi.mock("./cli", () => ({
  installCli: vi.fn(),
}))

vi.mock("./i18n", () => ({
  initI18n: vi.fn(async () => {}),
  t: (key: string) => key,
}))

describe("desktop menu terminal shortcuts", () => {
  beforeEach(() => {
    menuItems.length = 0
  })

  test("does not reserve Cmd+D for New Terminal", async () => {
    const { createMenu } = await import("./menu")
    await createMenu()

    const newTerminal = menuItems.find((item) => item.text === "New Terminal (Cmd+Alt+T)")
    expect(newTerminal).toBeTruthy()
    expect(newTerminal?.accelerator).toBe("CmdOrCtrl+Alt+T")

    const cmdD = menuItems.find((item) => item.accelerator === "CmdOrCtrl+D")
    expect(cmdD).toBeUndefined()
  })
})


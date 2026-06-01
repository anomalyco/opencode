import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"

type OpenSessionHeaderDirectory = typeof import("./session-header").openSessionHeaderDirectory
type SessionHeaderOpenVisible = typeof import("./session-header").sessionHeaderOpenVisible

let openSessionHeaderDirectory: OpenSessionHeaderDirectory
let sessionHeaderOpenVisible: SessionHeaderOpenVisible

const projectDirectory = "E:\\works\\opencode"
const openPath = mock((_path: string, _app?: string) => Promise.resolve())
const onError = mock(() => undefined)
const opening: Array<string | undefined> = []

beforeAll(async () => {
  const noop = () => null
  mock.module("@/context/command", () => ({ useCommand: noop }))
  mock.module("@/context/language", () => ({ useLanguage: noop }))
  mock.module("@/context/layout", () => ({ useLayout: noop }))
  mock.module("@/context/platform", () => ({ usePlatform: noop }))
  mock.module("@/context/server", () => ({ useServer: noop }))
  mock.module("@/context/settings", () => ({ useSettings: noop }))
  mock.module("@/context/sync", () => ({ useSync: noop }))
  mock.module("@/context/terminal", () => ({ useTerminal: noop }))
  mock.module("@/pages/session/helpers", () => ({ focusTerminalById: noop }))
  mock.module("@/pages/session/session-layout", () => ({ useSessionLayout: noop }))
  mock.module("@opencode-ai/ui/app-icon", () => ({ AppIcon: noop }))
  mock.module("@opencode-ai/ui/button", () => ({ Button: noop }))
  mock.module("@opencode-ai/ui/dropdown-menu", () => ({ DropdownMenu: Object.assign(noop, {}) }))
  mock.module("@opencode-ai/ui/icon", () => ({ Icon: noop }))
  mock.module("@opencode-ai/ui/icon-button", () => ({ IconButton: noop }))
  mock.module("@opencode-ai/ui/keybind", () => ({ Keybind: noop }))
  mock.module("@opencode-ai/ui/spinner", () => ({ Spinner: noop }))
  mock.module("@opencode-ai/ui/toast", () => ({ Toast: Object.assign(noop, { Region: noop }), showToast: noop }))
  mock.module("@opencode-ai/ui/tooltip", () => ({ Tooltip: noop, TooltipKeybind: noop }))
  mock.module("@opencode-ai/ui/v2/components/icon-button-v2.jsx", () => ({ IconButtonV2: noop }))
  mock.module("@opencode-ai/ui/v2/components/icon.jsx", () => ({ Icon: noop }))
  mock.module("../status-popover", () => ({ StatusPopover: noop, StatusPopoverV2: noop }))

  const mod = await import("./session-header")
  openSessionHeaderDirectory = mod.openSessionHeaderDirectory
  sessionHeaderOpenVisible = mod.sessionHeaderOpenVisible
})

beforeEach(() => {
  openPath.mockReset()
  openPath.mockImplementation(() => Promise.resolve())
  onError.mockClear()
  opening.length = 0
})

describe("SessionHeader V2 open folder action", () => {
  test("uses the same local desktop visibility gate as the classic header", () => {
    expect(sessionHeaderOpenVisible({ canOpen: true, directory: projectDirectory })).toBe(true)
    expect(sessionHeaderOpenVisible({ canOpen: false, directory: projectDirectory })).toBe(false)
    expect(sessionHeaderOpenVisible({ canOpen: true, directory: "" })).toBe(false)
  })

  test("opens the project directory with the selected open-with target", async () => {
    openSessionHeaderDirectory({
      opening: false,
      canOpen: true,
      openPath,
      directory: projectDirectory,
      app: "vscode",
      options: [
        { id: "finder" },
        { id: "vscode", openWith: "code" },
      ],
      setOpening: (app) => opening.push(app),
      onError,
    })

    expect(openPath.mock.calls).toEqual([[projectDirectory, "code"]])
    await settle()
    expect(opening).toEqual(["vscode", undefined])
  })

  test("skips unavailable openPath instead of producing a dead action", () => {
    openSessionHeaderDirectory({
      opening: false,
      canOpen: true,
      openPath: undefined,
      directory: projectDirectory,
      app: "finder",
      options: [{ id: "finder" }],
      setOpening: (app) => opening.push(app),
      onError,
    })

    expect(openPath).not.toHaveBeenCalled()
    expect(opening).toEqual([])
  })

  test("reports rejected openPath through the header error callback", async () => {
    const error = new Error("open failed")
    openPath.mockImplementation(() => Promise.reject(error))

    openSessionHeaderDirectory({
      opening: false,
      canOpen: true,
      openPath,
      directory: projectDirectory,
      app: "finder",
      options: [{ id: "finder" }],
      setOpening: (app) => opening.push(app),
      onError,
    })

    await settle()
    expect(onError).toHaveBeenCalledWith(error)
    expect(opening).toEqual(["finder", undefined])
  })
})

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

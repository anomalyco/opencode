import { beforeAll, describe, expect, mock, test } from "bun:test"

let getOpenPlan: typeof import("./session-header").getOpenPlan

beforeAll(async () => {
  mock.module("@opencode-ai/ui/app-icon", () => ({ AppIcon: () => null }))
  mock.module("@opencode-ai/ui/button", () => ({ Button: (props: { children?: unknown }) => props.children }))
  mock.module("@opencode-ai/ui/dropdown-menu", () => ({
    DropdownMenu: (props: { children?: unknown }) => props.children,
  }))
  mock.module("@opencode-ai/ui/icon", () => ({ Icon: () => null }))
  mock.module("@opencode-ai/ui/icon-button", () => ({ IconButton: () => null }))
  mock.module("@opencode-ai/ui/keybind", () => ({ Keybind: () => null }))
  mock.module("@opencode-ai/ui/spinner", () => ({ Spinner: () => null }))
  mock.module("@opencode-ai/ui/toast", () => ({ showToast: () => undefined }))
  mock.module("@opencode-ai/ui/tooltip", () => ({
    Tooltip: (props: { children?: unknown }) => props.children,
    TooltipKeybind: () => null,
  }))
  mock.module("@opencode-ai/util/path", () => ({
    getFilename: (value: string) => value.split("/").filter(Boolean).at(-1) ?? value,
  }))
  mock.module("solid-js/web", () => ({ Portal: (props: { children?: unknown }) => props.children }))
  mock.module("@/context/command", () => ({ useCommand: () => ({ keybind: () => "", trigger: () => undefined }) }))
  mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (value: string) => value }) }))
  mock.module("@/context/layout", () => ({ useLayout: () => ({ projects: { list: () => [] } }) }))
  mock.module("@/context/platform", () => ({
    usePlatform: () => ({ platform: "desktop", openPath: async () => undefined }),
  }))
  mock.module("@/context/server", () => ({ useServer: () => ({ isLocal: () => true }) }))
  mock.module("@/context/terminal", () => ({ useTerminal: () => ({ active: () => undefined }) }))
  mock.module("@/pages/session/helpers", () => ({ focusTerminalById: () => undefined }))
  mock.module("@/pages/session/session-layout", () => ({
    useSessionLayout: () => ({
      params: { dir: "" },
      view: () => ({ terminal: { opened: () => false, toggle: () => undefined } }),
    }),
  }))
  mock.module("@/utils/base64", () => ({ decode64: () => "" }))
  mock.module("@/utils/persist", () => ({
    Persist: { global: () => "" },
    persisted: (_key: string, value: unknown) => value,
  }))
  mock.module("../status-popover", () => ({ StatusPopover: () => null }))
  const mod = await import("./session-header")
  getOpenPlan = mod.getOpenPlan
})

describe("session header open plan", () => {
  test("routes wezterm through editor integration when available", () => {
    expect(getOpenPlan("wezterm", [{ id: "wezterm", openWith: "WezTerm" }], true)).toEqual({
      kind: "editor",
      editor: "WezTerm",
    })
  })

  test("falls back to openPath when editor integration is unavailable", () => {
    expect(getOpenPlan("wezterm", [{ id: "wezterm", openWith: "WezTerm" }], false)).toEqual({
      kind: "path",
      app: "WezTerm",
    })
  })

  test("keeps other apps on openPath", () => {
    expect(getOpenPlan("ghostty", [{ id: "ghostty", openWith: "Ghostty" }], true)).toEqual({
      kind: "path",
      app: "Ghostty",
    })
  })
})

/** @jsxImportSource @opentui/solid */
import { MouseButton, TextAttributes } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { ConfigProvider, useConfig, type Info } from "../../src/config"
import { EMPTY_SESSION_TAB_STATUS, SessionTabs, type SessionTabsController } from "../../src/component/session-tabs"
import { moveSessionTab, type SessionTab } from "../../src/context/session-tabs-model"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider, useTheme } from "../../src/context/theme"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { SPINNER_FRAMES } from "../../src/component/spinner-frames"
import { SESSION_SIDEBAR_WIDTH, SESSION_TABS_COMPACT_BREAKPOINT, SESSION_TABS_COMPACT_WIDTH } from "../../src/ui/layout"

for (const mode of ["dark", "light"] as const) {
  test(`${mode} rail uses dense title initials, existing active styling, search, and mouse controls`, async () => {
    const [width, setWidth] = createSignal(SESSION_TABS_COMPACT_WIDTH)
    const compact = () => width() < SESSION_TABS_COMPACT_BREAKPOINT
    const [animations, setAnimations] = createSignal(false)
    const [active, setActive] = createSignal("first")
    const [newTab, setNewTab] = createSignal(false)
    const [searches, setSearches] = createSignal(0)
    const [status, setStatus] = createSignal(EMPTY_SESSION_TAB_STATUS)
    const settings: Info = { tabs: { indicators: "status" } }
    const [items, setItems] = createSignal<SessionTab[]>([
      { sessionID: "first", title: "First session" },
      { sessionID: "second", title: "Second session" },
      { sessionID: "third", title: "Third session" },
    ])
    const closed: string[] = []
    let theme!: ReturnType<typeof useTheme>
    let config!: ReturnType<typeof useConfig>
    function CaptureContext() {
      theme = useTheme("elevated")
      config = useConfig()
      Keymap.createLayer(() => ({
        mode: "global",
        commands: [
          {
            id: "session.list",
            run() {
              setSearches((value) => value + 1)
            },
          },
        ],
      }))
      return null
    }
    const controller: SessionTabsController = {
      tabs: items,
      current: active,
      newTab,
      add: () => setNewTab(true),
      select: setActive,
      close(sessionID) {
        if (sessionID) closed.push(sessionID)
      },
      move(sessionID, index) {
        setItems((items) => moveSessionTab(items, sessionID, index))
      },
      detail: (sessionID) => (sessionID === "third" ? "project-beta" : "project-alpha"),
      status: (sessionID) => (sessionID === "second" ? status() : EMPTY_SESSION_TAB_STATUS),
    }
    const app = await testRender(
      () => (
        <TestTuiContexts>
          <ConfigProvider
            config={createTuiResolvedConfig(settings)}
            service={{
              get: async () => settings,
              update: async (update) => {
                update(settings)
                return settings
              },
            }}
          >
            <Keymap.Provider>
              <ThemeProvider mode={mode} source={emptyThemeSource}>
                <ToastProvider>
                  <DialogProvider>
                    <CaptureContext />
                    <box width="100%" height="100%" flexDirection="row">
                      <SessionTabs
                        controller={controller}
                        orientation="vertical"
                        animations={animations()}
                        width={width()}
                      />
                      <text>transcript</text>
                    </box>
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </Keymap.Provider>
          </ConfigProvider>
        </TestTuiContexts>
      ),
      { width: 80, height: 24 },
    )
    try {
      app.renderer.start()
      await app.waitForFrame((frame) => frame.includes("  F  ") && frame.includes("  S  "))
      expect(app.captureCharFrame().split("\n")[0]!.indexOf("transcript")).toBe(5)
      expect(
        app
          .captureCharFrame()
          .split("\n")
          .every((line) => !/\d/.test(line.slice(0, 5))),
      ).toBe(true)
      expect(
        app
          .captureCharFrame()
          .split("\n")
          .slice(0, 11)
          .map((line) => line.slice(0, 5)),
      ).toEqual(["▄▄▄▄▄", "  ⌕  ", "▄▄▄▄▄", "  F  ", "▀▀▀▀▀", "  S  ", "     ", "  T  ", "     ", "  +  ", "     "])
      expect(app.captureCharFrame()).not.toContain("First session")
      expect(app.captureCharFrame()).not.toContain("Second session")
      const activeLabel = app.captureSpans().lines[3]!.spans.find((span) => span.text.trim() === "F")!
      const inactiveLabel = app.captureSpans().lines[5]!.spans.find((span) => span.text.trim() === "S")!
      const selectedBackground = activeLabel.bg.toInts()
      const background = (row: number) => app.captureSpans().lines[row]!.spans[0]!.bg.toInts()
      expect(selectedBackground).not.toEqual(inactiveLabel.bg.toInts())
      expect(activeLabel.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
      expect(inactiveLabel.attributes & TextAttributes.BOLD).toBe(0)
      expect(activeLabel.fg.toInts()).toEqual(theme.text.default.toInts())
      expect(inactiveLabel.fg.toInts()).toEqual(theme.text.subdued.toInts())
      expect(background(0)).toEqual(theme.background.default.toInts())
      expect(app.captureSpans().lines[0]!.spans[0]!.fg.toInts()).toEqual(theme.background.default.toInts())

      for (const state of [
        { value: { busy: true }, label: SPINNER_FRAMES[0] },
        { value: { busy: true, attention: "question" }, label: "?" },
        { value: { busy: true, attention: "permission" }, label: "!" },
        { value: { unread: "activity" }, label: "•" },
      ] as const) {
        setStatus({ ...EMPTY_SESSION_TAB_STATUS, ...state.value })
        await app.waitForFrame((frame) => frame.split("\n")[5]!.slice(0, 5).trim() === state.label)
        expect(app.captureCharFrame().split("\n")[5]!.indexOf(state.label)).toBe(2)
        setActive("second")
        await app.renderOnce()
        const selected = app.captureSpans().lines[5]!.spans.find((span) => span.text.trim() === state.label)!
        expect(selected.fg.toInts()).toEqual(theme.text.default.toInts())
        expect(selected.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
        setActive("first")
      }
      setStatus({ ...EMPTY_SESSION_TAB_STATUS, busy: true })
      setActive("second")
      setAnimations(true)
      await app.waitForFrame((frame) => SPINNER_FRAMES.includes(frame.split("\n")[5]!.slice(0, 5).trim()))
      expect(
        app
          .captureSpans()
          .lines[5]!.spans.find((span) => SPINNER_FRAMES.includes(span.text.trim()))!
          .fg.toInts(),
      ).toEqual(theme.text.default.toInts())
      setActive("first")
      await app.renderOnce()
      for (const size of [6, 10, 11, 5]) {
        setWidth(size)
        await app.renderOnce()
        const lines = app.captureCharFrame().split("\n")
        const spinner = lines[5]!.trim()
        expect(SPINNER_FRAMES).toContain(spinner)
        expect(lines[5]!.indexOf(spinner)).toBe(lines[3]!.indexOf("F"))
      }
      expect(
        app
          .captureSpans()
          .lines[5]!.spans.find((span) => SPINNER_FRAMES.includes(span.text.trim()))!
          .fg.toInts(),
      ).toEqual(theme.text.status.running.toInts())
      setAnimations(false)
      await config.update((draft) => {
        draft.tabs.indicators = "numbers"
      })
      await app.waitForFrame((frame) => frame.split("\n")[5]!.slice(0, 5).trim() === "2")
      expect([3, 5, 7].map((row) => app.captureCharFrame().split("\n")[row]!.slice(0, 5).trim())).toEqual([
        "1",
        "2",
        "3",
      ])
      expect(
        app
          .captureSpans()
          .lines[3]!.spans.find((span) => span.text.trim() === "1")!
          .fg.toInts(),
      ).toEqual(theme.text.default.toInts())
      setActive("second")
      await app.renderOnce()
      const selectedNumber = app.captureSpans().lines[5]!.spans.find((span) => span.text.trim() === "2")!
      expect(selectedNumber.fg.toInts()).toEqual(theme.text.default.toInts())
      expect(selectedNumber.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
      setActive("first")
      await config.update((draft) => {
        draft.tabs.indicators = "status"
      })
      await app.waitForFrame((frame) => frame.split("\n")[5]!.slice(0, 5).trim() === SPINNER_FRAMES[0])
      setStatus(EMPTY_SESSION_TAB_STATUS)
      await app.waitForFrame((frame) => frame.split("\n")[5]!.slice(0, 5).trim() === "S")

      await app.mockMouse.moveTo(2, 1)
      await app.renderOnce()
      expect(background(0)).toEqual(theme.background.default.toInts())
      expect(app.captureCharFrame().split("\n")[0]!.slice(0, 5)).toBe("▄▄▄▄▄")
      expect(app.captureSpans().lines[0]!.spans[0]!.fg.toInts()).toEqual(
        app
          .captureSpans()
          .lines[1]!.spans.find((span) => span.text.includes("⌕"))!
          .bg.toInts(),
      )
      expect(app.captureCharFrame().split("\n")[2]!.slice(0, 5)).toBe("▀▀▀▀▀")
      expect(app.captureSpans().lines[2]!.spans[0]!.fg.toInts()).toEqual(
        app
          .captureSpans()
          .lines[1]!.spans.find((span) => span.text.includes("⌕"))!
          .bg.toInts(),
      )
      expect(background(2)).toEqual(selectedBackground)

      await app.mockMouse.moveTo(1, 3)
      await app.waitForFrame((frame) => frame.includes("First session"))
      expect(app.captureCharFrame().split("\n")[2]!.slice(0, 5)).toBe("▄▄▄▄▄")
      expect(app.captureSpans().lines[2]!.spans[0]!.fg.toInts()).toEqual(
        app
          .captureSpans()
          .lines[3]!.spans.find((span) => span.text.trim() === "F")!
          .bg.toInts(),
      )
      expect(app.captureSpans().lines[2]!.spans[0]!.bg.toInts()).toEqual(theme.background.default.toInts())
      expect(app.captureCharFrame().split("\n")[2]!.slice(5, 59)).toBe("▄".repeat(54))
      await app.mockMouse.moveTo(1, 5)
      await app.waitForFrame((frame) => frame.includes("Second session"))
      expect(app.captureCharFrame().split("\n")[2]!.slice(0, 5)).toBe("▄▄▄▄▄")
      expect(app.captureSpans().lines[2]!.spans[0]!.bg.toInts()).toEqual(theme.background.default.toInts())
      expect(active()).toBe("first")
      expect(app.captureCharFrame()).toContain("project-alpha")
      expect(
        app
          .captureCharFrame()
          .split("\n")
          .findIndex((line) => line.includes("Second session")),
      ).toBe(5)
      await app.mockMouse.moveTo(3, 5)
      await app.renderOnce()
      expect(
        app
          .captureCharFrame()
          .split("\n")
          .findIndex((line) => line.includes("Second session")),
      ).toBe(5)
      expect(app.captureSpans().lines[4]!.spans[0]!.fg.toInts()).toEqual(selectedBackground)
      expect(background(4)).toEqual(selectedBackground)
      expect(background(3)).toEqual(selectedBackground)
      expect(background(5)).toEqual(selectedBackground)
      expect(app.captureCharFrame().split("\n")[6]!.slice(0, 5)).toBe("▀▀▀▀▀")
      expect(app.captureCharFrame().split("\n")[4]!.slice(5, 59)).toBe("▄".repeat(54))
      expect(app.captureCharFrame().split("\n")[7]!.slice(5, 59)).toBe("▀".repeat(54))

      await app.mockMouse.moveTo(12, 0)
      await app.waitForFrame((frame) => !frame.includes("Second session"))
      expect(background(3)).toEqual(selectedBackground)
      expect(background(5)).toEqual(theme.background.default.toInts())
      expect(background(4)).toEqual(theme.background.default.toInts())
      setActive("third")
      await app.renderOnce()
      expect(background(3)).toEqual(theme.background.default.toInts())
      expect(background(7)).toEqual(selectedBackground)
      expect(app.captureCharFrame()).not.toContain("Third session")
      expect(app.captureCharFrame().split("\n")[2]!.slice(0, 5)).toBe("     ")
      setActive("first")

      await app.mockMouse.pressDown(12, 0)
      await app.mockMouse.release(2, 1)
      expect(compact()).toBe(true)
      expect(searches()).toBe(0)
      setStatus({ ...EMPTY_SESSION_TAB_STATUS, busy: true, attention: "question" })
      setWidth(SESSION_SIDEBAR_WIDTH)
      await app.waitForFrame((frame) => frame.includes("Third session"))
      expect(compact()).toBe(false)
      expect(app.captureCharFrame()).not.toContain("Search sessions")
      expect(app.captureCharFrame()).not.toContain("Tabs ·")
      expect(
        app
          .captureCharFrame()
          .split("\n")
          .slice(1, 11)
          .map((line) => line.slice(0, 42).trimEnd()),
      ).toEqual([
        "   First session",
        "   project-alpha",
        "▄▄▄▄▄▄▄▄▄▄",
        " ? Second session",
        "   project-alpha",
        "▄▄▄▄▄▄▄▄▄▄",
        "   Third session",
        "   project-beta",
        "",
        " + New session",
      ])
      await config.update((draft) => {
        draft.tabs.indicators = "numbers"
      })
      await app.waitForFrame((frame) => frame.includes("2 Second session"))
      expect(app.captureCharFrame().split("\n")[4]!.trimStart().startsWith("2 Second session")).toBe(true)
      await config.update((draft) => {
        draft.tabs.indicators = "status"
      })
      await app.waitForFrame((frame) => frame.includes("? Second session"))

      await app.mockMouse.click(8, 7)
      expect(active()).toBe("third")

      setWidth(SESSION_TABS_COMPACT_WIDTH)
      await app.waitForFrame((frame) => frame.split("\n")[0]!.indexOf("transcript") === 5)
      await app.mockMouse.click(2, 5, MouseButton.MIDDLE)
      expect(closed).toEqual(["second"])
      expect(active()).toBe("third")
      await app.mockMouse.drag(2, 3, 2, 7)
      expect(items().map((tab) => tab.sessionID)).toEqual(["second", "third", "first"])
      expect(active()).toBe("first")

      setItems(
        Array.from({ length: 40 }, (_, index) => ({ sessionID: `tab-${index + 1}`, title: `Session ${index + 1}` })),
      )
      setActive("tab-40")
      await app.waitForVisualIdle()
      expect(app.captureCharFrame().split("\n")[2]!.slice(0, 5)).toBe("     ")
      setActive("tab-30")
      await app.waitForVisualIdle()
      expect(app.captureCharFrame().split("\n")[2]!.slice(0, 5)).toBe("▄▄▄▄▄")
      await app.mockMouse.scroll(2, 10, "down")
      await app.mockMouse.scroll(2, 10, "down")
      await app.waitForFrame((frame) => frame.split("\n")[2]!.slice(0, 5) === "     ")
      setActive("tab-1")
      await app.waitForVisualIdle()
      setActive("tab-40")
      await app.waitForVisualIdle()
      await app.mockMouse.moveTo(2, 22)
      await app.waitForFrame((frame) => frame.includes("Session 40"))
      app.resize(60, 16)
      await app.waitForVisualIdle()
      await app.mockMouse.moveTo(2, 14)
      await app.waitForFrame((frame) => frame.split("\n")[0]!.length === 60 && frame.includes("Session 40"))
      await app.mockMouse.click(2, 1)
      expect(searches()).toBe(1)
      expect(active()).toBe("tab-40")
      await config.update((draft) => {
        draft.tabs.indicators = "numbers"
      })
      await app.waitForFrame((frame) => frame.split("\n")[14]!.slice(0, 5).trim() === "40")
      setNewTab(true)
      await app.waitForFrame((frame) => frame.includes("  +  "))
      expect(background(14)).toEqual(selectedBackground)

      setItems([])
      setWidth(SESSION_SIDEBAR_WIDTH)
      await app.waitForVisualIdle()
      setItems([{ sessionID: "first", title: "First session" }])
      await app.waitForVisualIdle()
      expect(app.captureCharFrame().split("\n")[1]).toContain("First session")
      expect(app.captureCharFrame().split("\n")[4]).toContain("+ New session")
    } finally {
      app.renderer.destroy()
    }
  })
}

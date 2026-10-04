/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { EMPTY_SESSION_TAB_STATUS, SessionTabs, type SessionTabsController } from "../../src/component/session-tabs"
import { SPINNER_FRAMES } from "../../src/component/spinner-frames"
import { type SessionTab } from "../../src/context/session-tabs-model"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { SESSION_SIDEBAR_WIDTH } from "../../src/ui/layout"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("grouped rail follows session status without toggling collapse", async () => {
  const [active, setActive] = createSignal("first")
  const [items] = createSignal<SessionTab[]>([
    { sessionID: "first", title: "First session" },
    { sessionID: "second", title: "Second session" },
  ])
  const [status, setStatus] = createSignal(EMPTY_SESSION_TAB_STATUS)
  const directories: Record<string, string> = { first: "/repo/alpha", second: "/repo/beta" }
  const controller = {
    tabs: items,
    current: active,
    add() {},
    select: setActive,
    close() {},
    move() {},
    directory: (sessionID: string) => directories[sessionID],
    status: (sessionID: string) => (sessionID === "second" ? status() : EMPTY_SESSION_TAB_STATUS),
  } satisfies SessionTabsController
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider
          config={createTuiResolvedConfig({
            tabs: { indicators: "status" },
          })}
        >
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <box width="100%" height="100%" flexDirection="row">
                <SessionTabs controller={controller} orientation="vertical" animations={false} width={SESSION_SIDEBAR_WIDTH} />
                <text>transcript</text>
              </box>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("alpha") && frame.includes("beta"))
    setStatus({ ...EMPTY_SESSION_TAB_STATUS, busy: true })
    await app.waitForFrame((frame) => frame.includes(SPINNER_FRAMES[0]))
    setStatus(EMPTY_SESSION_TAB_STATUS)
    await app.waitForFrame((frame) => !frame.includes(SPINNER_FRAMES[0]) && frame.includes("Second session"))
  } finally {
    app.renderer.stop()
  }
})

test("places the new-session entry above folder groups", async () => {
  const [active, setActive] = createSignal("first")
  const [items] = createSignal<SessionTab[]>([{ sessionID: "first", title: "First session" }])
  const controller = {
    tabs: items,
    current: active,
    add() {},
    select: setActive,
    close() {},
    move() {},
    directory: () => "/repo/alpha",
    status: () => EMPTY_SESSION_TAB_STATUS,
  } satisfies SessionTabsController
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider
          config={createTuiResolvedConfig({
            tabs: { indicators: "status" },
          })}
        >
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <box width="100%" height="100%" flexDirection="row">
                <SessionTabs controller={controller} orientation="vertical" animations={false} width={SESSION_SIDEBAR_WIDTH} />
                <text>transcript</text>
              </box>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("alpha") && frame.includes("+ New session"))
    const lines = app.captureCharFrame().split("\n")
    const addAt = lines.findIndex((line) => line.includes("+ New session"))
    const headerAt = lines.findIndex((line) => line.includes("▾"))
    expect(addAt).toBeGreaterThan(-1)
    expect(headerAt).toBeGreaterThan(-1)
    expect(addAt).toBeLessThan(headerAt)
  } finally {
    app.renderer.stop()
  }
})

test("collapses and expands a folder group from its header", async () => {
  const [active, setActive] = createSignal("first")
  const [items] = createSignal<SessionTab[]>([
    { sessionID: "first", title: "First session" },
    { sessionID: "second", title: "Second session" },
    { sessionID: "third", title: "Third session" },
  ])
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})
  const directories: Record<string, string> = { first: "/repo/alpha", second: "/repo/beta", third: "/repo/alpha" }
  const controller = {
    tabs: items,
    current: active,
    add() {},
    select: setActive,
    close() {},
    move() {},
    directory: (sessionID: string) => directories[sessionID],
    collapsed,
    isCollapsed: (key: string) => collapsed()[key] ?? false,
    toggleCollapsed: (key: string) => setCollapsed((previous) => ({ ...previous, [key]: !previous[key] })),
    status: () => EMPTY_SESSION_TAB_STATUS,
  } satisfies SessionTabsController
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig({ tabs: { indicators: "status" } })}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <box width="100%" height="100%" flexDirection="row">
                <SessionTabs controller={controller} orientation="vertical" animations={false} width={SESSION_SIDEBAR_WIDTH} />
                <text>transcript</text>
              </box>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame(
      (frame) => frame.includes("First session") && frame.includes("Second session") && frame.includes("▾ alpha"),
    )
    expect(active()).toBe("first")

    const headerRow = () =>
      app
        .captureCharFrame()
        .split("\n")
        .findIndex((line) => line.includes("alpha"))
    await app.mockMouse.click(1, headerRow())
    await app.waitForFrame((frame) => frame.includes("▸ alpha"))
    expect(app.captureCharFrame()).not.toContain("First session")
    expect(app.captureCharFrame()).not.toContain("Third session")
    expect(app.captureCharFrame()).toContain("Second session")
    expect(active()).toBe("first")

    await app.mockMouse.click(1, headerRow())
    await app.waitForFrame((frame) => frame.includes("First session") && frame.includes("▾ alpha"))
    expect(app.captureCharFrame()).toContain("Third session")
  } finally {
    app.renderer.stop()
  }
})

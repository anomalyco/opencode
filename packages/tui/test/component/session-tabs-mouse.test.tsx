/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { MouseButton } from "@opentui/core"
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { EMPTY_SESSION_TAB_STATUS, SessionTabs, type SessionTabsController } from "../../src/component/session-tabs"
import { ThemeProvider } from "../../src/context/theme"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("scrolls hidden tabs into view without switching the active session", async () => {
  const titles = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]
  const [active, setActive] = createSignal("One")
  const controller = {
    tabs: () => titles.map((title) => ({ sessionID: title, title })),
    current: active,
    select: setActive,
    close() {},
    move() {},
    status: () => EMPTY_SESSION_TAB_STATUS,
  } satisfies SessionTabsController
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig({ tabs: { mode: "on" } })}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <box flexDirection="column">
              <SessionTabs controller={controller} animations={false} />
              <text>selectable transcript text</text>
            </box>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 46, height: 24 },
  )

  try {
    await app.renderOnce()
    const strip = () => app.captureCharFrame().split("\n")[0] ?? ""
    expect(strip()).toContain("Two")
    await app.mockMouse.click(strip().indexOf("Two"), 0)
    expect(active()).toBe("Two")
    await app.renderOnce()
    expect(strip()).not.toContain("Nine")
    expect(strip()).toContain("›")

    const beforeScroll = strip()
    await app.mockMouse.pressDown(5, 1)
    await app.mockMouse.release(strip().indexOf("›"), 0)
    await app.renderOnce()
    expect(strip()).toBe(beforeScroll)

    const scrollTo = async (indicator: string, title: string) => {
      for (let index = 0; index < titles.length && !strip().includes(title); index++) {
        expect(strip()).toContain(indicator)
        await app.mockMouse.click(strip().indexOf(indicator), 0)
        await app.renderOnce()
      }
      expect(strip()).toContain(title)
    }
    await scrollTo("›", "Nine")
    expect(strip()).not.toContain("Two")
    expect(active()).toBe("Two")
    await app.mockMouse.click(strip().indexOf("Nine"), 0)
    expect(active()).toBe("Nine")
    await app.renderOnce()

    await scrollTo("‹", "One")
    expect(active()).toBe("Nine")
    await app.mockMouse.scroll(10, 0, "down")
    await app.renderOnce()
    expect(strip()).not.toContain("One")
    await app.mockMouse.scroll(10, 0, "up")
    await app.renderOnce()
    expect(strip()).toContain("One")
    expect(active()).toBe("Nine")

    setActive("Eight")
    await app.renderOnce()
    expect(strip()).toContain("Eight")
  } finally {
    app.renderer.destroy()
  }
})

test("releasing a transcript selection over tab controls does not activate them", async () => {
  const [active, setActive] = createSignal("first")
  const [added, setAdded] = createSignal(0)
  const controller = {
    tabs: () => [
      { sessionID: "first", title: "First" },
      { sessionID: "second", title: "Second" },
    ],
    current: active,
    select: setActive,
    close() {},
    move() {},
    add: () => setAdded((value) => value + 1),
    status: () => EMPTY_SESSION_TAB_STATUS,
  } satisfies SessionTabsController
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig({ tabs: { mode: "on" } })}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <box flexDirection="column">
              <SessionTabs controller={controller} animations={false} />
              <text>selectable transcript text</text>
            </box>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 3 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Second"))
    await app.mockMouse.pressDown(5, 1)
    await app.mockMouse.release(40, 0)
    expect(active()).toBe("first")

    await app.mockMouse.click(40, 0)
    expect(active()).toBe("second")

    await app.mockMouse.pressDown(5, 1)
    await app.mockMouse.release(58, 0)
    expect(added()).toBe(0)

    await app.mockMouse.click(58, 0)
    expect(added()).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})

test("middle-click closes a session tab without selecting it", async () => {
  const [active, setActive] = createSignal("first")
  const closed: Array<string | undefined> = []
  const controller = {
    tabs: () => [
      { sessionID: "first", title: "First" },
      { sessionID: "second", title: "Second" },
    ],
    current: active,
    select: setActive,
    close: (sessionID?: string) => closed.push(sessionID),
    move() {},
    status: () => EMPTY_SESSION_TAB_STATUS,
  } satisfies SessionTabsController
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig({ tabs: { mode: "on" } })}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <SessionTabs controller={controller} animations={false} />
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 8 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Second"))
    await app.mockMouse.click(40, 0, MouseButton.MIDDLE)
    expect(closed).toEqual(["second"])
    expect(active()).toBe("first")
  } finally {
    app.renderer.destroy()
  }
})

test("keeps consecutive close controls fixed across overflow window changes", async () => {
  const [active, setActive] = createSignal("fifth")
  const [items, setItems] = createSignal([
    { sessionID: "first", title: "First" },
    { sessionID: "second", title: "Second" },
    { sessionID: "third", title: "Third" },
    { sessionID: "fourth", title: "Fourth" },
    { sessionID: "fifth", title: "Fifth" },
  ])
  const closed: string[] = []
  const controller = {
    tabs: items,
    current: active,
    select: setActive,
    close: (sessionID?: string) => {
      if (!sessionID) return
      const current = items()
      closed.push(sessionID)
      setActive("first")
      setItems(current.filter((tab) => tab.sessionID !== sessionID))
    },
    move() {},
    status: () => EMPTY_SESSION_TAB_STATUS,
  } satisfies SessionTabsController
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig({ tabs: { mode: "on" } })}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <SessionTabs controller={controller} animations={false} />
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 46, height: 2 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Third"))
    await app.mockMouse.moveTo(11, 0)
    await app.waitForFrame((frame) => Array.from(frame.split("\n")[0] ?? "")[11] === "✕")

    await app.mockMouse.click(11, 0)
    await app.waitForFrame(
      (frame) => !frame.includes("Third") && items().length === 4 && Array.from(frame.split("\n")[0] ?? "")[11] === "✕",
    )
    await app.mockMouse.click(11, 0)

    expect(closed).toEqual(["third", "fourth"])
  } finally {
    app.renderer.destroy()
  }
})

test("reflows held tabs when the pointer leaves the strip", async () => {
  const [active, setActive] = createSignal("first")
  const [items, setItems] = createSignal([
    { sessionID: "first", title: "First" },
    { sessionID: "second", title: "Second" },
    { sessionID: "third", title: "Third" },
    { sessionID: "fourth", title: "Fourth" },
  ])
  const controller = {
    tabs: items,
    current: active,
    select: setActive,
    close: (sessionID?: string) => {
      if (!sessionID) return
      const current = items()
      const index = current.findIndex((tab) => tab.sessionID === sessionID)
      setActive((current[index + 1] ?? current[index - 1])?.sessionID)
      setItems(current.filter((tab) => tab.sessionID !== sessionID))
    },
    move() {},
    status: () => EMPTY_SESSION_TAB_STATUS,
  } satisfies SessionTabsController
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig({ tabs: { mode: "on" } })}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <box flexDirection="column">
              <SessionTabs controller={controller} animations={false} />
              <text>outside</text>
            </box>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 2 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Fourth"))
    await app.mockMouse.moveTo(22, 0)
    await app.waitForFrame((frame) => Array.from(frame.split("\n")[0] ?? "")[22] === "✕")
    await app.mockMouse.click(22, 0)
    await app.waitForFrame(
      (frame) => !frame.includes("First") && items().length === 3 && Array.from(frame.split("\n")[0] ?? "")[22] === "✕",
    )

    await app.renderOnce()
    const held = app.captureCharFrame().split("\n")[0] ?? ""
    await app.mockMouse.moveTo(0, 1)
    await app.waitForFrame((frame) => (frame.split("\n")[0] ?? "").indexOf("Third") < held.indexOf("Third"))
    await app.mockMouse.moveTo(20, 0)
    await app.waitForFrame((frame) => Array.from(frame.split("\n")[0] ?? "")[20] === "✕")
    expect(Array.from(app.captureCharFrame().split("\n")[0] ?? "")[22]).not.toBe("✕")
  } finally {
    app.renderer.destroy()
  }
})

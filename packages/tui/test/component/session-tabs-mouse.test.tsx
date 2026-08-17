/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { EMPTY_SESSION_TAB_STATUS, SessionTabs, type SessionTabsController } from "../../src/component/session-tabs"
import { ThemeProvider } from "../../src/context/theme"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

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
    status: () => ({ ...EMPTY_SESSION_TAB_STATUS, busy: true }),
  } satisfies SessionTabsController
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig({ animations: false, tabs: { enabled: true } })}>
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
    expect(app.captureCharFrame()).not.toContain("1 First")
    expect(app.captureCharFrame()).toContain("⋯ First")
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

/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { ConfigProvider, type Info } from "../../src/config"
import { EMPTY_SESSION_TAB_STATUS, SessionTabs, type SessionTabsController } from "../../src/component/session-tabs"
import { ThemeProvider } from "../../src/context/theme"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

// Two tabs share a session title, the case from the issue: only the project tells them apart.
function tabsController(): SessionTabsController {
  return {
    tabs: () => [
      { sessionID: "first", title: "Fix login bug" },
      { sessionID: "second", title: "Fix login bug" },
    ],
    current: () => "first",
    select() {},
    close() {},
    move() {},
    detail: (sessionID) => (sessionID === "first" ? "opencode" : "website"),
    status: () => EMPTY_SESSION_TAB_STATUS,
  }
}

async function mount(settings: Info, orientation: "horizontal" | "vertical") {
  return testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig(settings)}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <box width="100%" height="100%">
              <SessionTabs controller={tabsController()} orientation={orientation} animations={false} />
            </box>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 10 },
  )
}

test("horizontal tabs prefix titles with the project when tabs.label is project", async () => {
  const app = await mount({ tabs: { mode: "on", label: "project" } }, "horizontal")

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("opencode: Fix login bug"))
    expect(app.captureCharFrame()).toContain("website: Fix login bug")
  } finally {
    app.renderer.destroy()
  }
})

test("horizontal tabs keep plain titles when tabs.label is unset", async () => {
  const app = await mount({ tabs: { mode: "on" } }, "horizontal")

  try {
    app.renderer.start()
    const frame = await app.waitForFrame((value) => value.includes("Fix login bug"))
    expect(frame).not.toContain("opencode")
  } finally {
    app.renderer.destroy()
  }
})

test("vertical tabs keep the project in the detail line without prefixing titles", async () => {
  const app = await mount({ tabs: { mode: "on", label: "project" } }, "vertical")

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("opencode"))
    const rows = app.captureCharFrame().split("\n")
    expect(rows.some((line) => line.trim() === "opencode")).toBeTrue()
    expect(rows.some((line) => line.trim() === "website")).toBeTrue()
    expect(rows.some((line) => line.includes("opencode: Fix login bug"))).toBeFalse()
  } finally {
    app.renderer.destroy()
  }
})

/** @jsxImportSource @opentui/solid */
import { ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { LocationProvider } from "../../src/context/location"
import { Keymap } from "../../src/context/keymap"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { ThemeProvider, useTheme } from "../../src/context/theme"
import { DialogStatus } from "../../src/component/dialog-status"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { createApi, createEventStream, createFetch } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test.each([
  { width: 100, active: true, reads: "restricted", escalation: "on-request" },
  { width: 44, active: true, reads: "restricted", escalation: "on-request" },
  { width: 44, active: true, reads: "broad", escalation: "never" },
  { width: 44, active: false, reads: "unrestricted", escalation: "disabled" },
])("sandbox status reports the connected policy at $width columns ($reads)", async (scenario) => {
  await using temporary = await tmpdir()
  const events = createEventStream()
  const fetch = createFetch(
    (url) =>
      url.pathname === "/api/experimental/sandbox/status"
        ? Response.json({
            active: scenario.active,
            reads: scenario.reads,
            escalation: scenario.escalation,
            writableRoots: scenario.active ? Array.from({ length: 12 }, (_, i) => i === 1 ? `/server/${"a".repeat(70)}` : `/server/root-${i}`) : [],
            readableRoots: [],
          })
        : undefined,
    events,
  )
  let theme: ReturnType<ReturnType<typeof useTheme>["surface"]> | undefined
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ClientProvider api={createApi(fetch.fetch)}>
            <DataProvider directory={temporary.path}>
              <LocationProvider>
                <ThemeProvider mode="dark" source={emptyThemeSource}>
                  {(() => {
                    theme = useTheme().surface("dialog")
                    return (
                      <Keymap.Provider>
                        <ToastProvider>
                          <DialogProvider>
                            <DialogStatus />
                          </DialogProvider>
                        </ToastProvider>
                      </Keymap.Provider>
                    )
                  })()}
                </ThemeProvider>
              </LocationProvider>
            </DataProvider>
          </ClientProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: scenario.width, height: 24 },
  )
  try {
    app.renderer.start()
    const label = scenario.active ? "Active" : "Disabled"
    await app.waitForFrame((frame) => frame.includes(label))
    const frame = app.captureCharFrame()
    expect(frame).toContain(scenario.active ? scenario.reads : "host access")
    const span = app.captureSpans().lines.flatMap((line) => line.spans).find((item) => item.text.includes(label))
    expect(span?.fg.equals(scenario.active ? theme!.text.feedback.success.base : theme!.text.feedback.warning.base)).toBe(true)
    const body = app.renderer.root.findDescendantById("status.body")
    if (!(body instanceof ScrollBoxRenderable)) throw new Error("Status scrollbox missing")
    expect(body.viewport.y + body.viewport.height).toBeLessThanOrEqual(24)
    if (scenario.active) {
      expect(frame).toContain("network blocked")
      expect(frame).toContain(scenario.escalation === "never" ? "disabled" : "approval")
      const lines = frame.split("\n")
      const labelLine = lines.findIndex((line) => line.includes("Writes:"))
      expect(labelLine).toBeGreaterThanOrEqual(0)
      expect(lines[labelLine + 1]).toContain("/server/root-0")
      expect(lines[labelLine + 1].indexOf("- /server/root-0") - lines[labelLine].indexOf("Writes:")).toBe(2)
      const marker = app.captureSpans().lines[labelLine + 1].spans.find((item) => item.text.includes("-"))
      expect(marker?.fg.equals(theme!.text.base)).toBe(true)
      if (scenario.width === 44) {
        const longLine = lines.findIndex((line) => line.includes("- /server/") && !line.includes("root-0"))
        expect(longLine).toBeGreaterThan(labelLine)
        expect(lines[longLine + 1]).toContain("aaaaaaaa")
        expect(lines[longLine + 1]).not.toContain("- ")
        expect(lines[longLine + 1].indexOf("aaaaaaaa")).toBe(lines[longLine].indexOf("/server/"))
      }
      const root = app.captureSpans().lines.flatMap((line) => line.spans).find((item) => item.text.includes("/server/root-0"))
      expect(root?.fg.equals(theme!.text.feedback.info.base)).toBe(true)
      body.scrollTo(body.scrollHeight)
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("/server/root-11")
      body.scrollTo(0)
      await app.renderOnce()
    } else {
      expect(frame).not.toContain("Writes:")
    }
    events.disconnect()
    await app.waitForFrame((current) => current.includes("Enforcement unknown"))
    expect(app.captureCharFrame()).not.toContain(label)
  } finally {
    app.renderer.destroy()
  }
})

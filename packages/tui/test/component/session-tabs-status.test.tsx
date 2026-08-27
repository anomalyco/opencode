/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { batch, createSignal } from "solid-js"
import { ConfigProvider, useConfig, type Info } from "../../src/config"
import {
  EMPTY_SESSION_TAB_STATUS,
  SessionTabs,
  type SessionTabsController,
  type SessionTabsStatus,
} from "../../src/component/session-tabs"
import { SPINNER_FRAMES } from "../../src/component/spinner-frames"
import { ClientProvider } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { LocationProvider } from "../../src/context/location"
import { RouteProvider } from "../../src/context/route"
import { TuiAppProvider } from "../../src/context/runtime"
import { SessionTabsProvider } from "../../src/context/session-tabs"
import { StorageProvider } from "../../src/context/storage"
import { ThemeProvider, useTheme } from "../../src/context/theme"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { createApi, createEventStream, createFetch } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

for (const orientation of ["horizontal", "vertical"] as const) {
  test(`${orientation} tabs replace ordinals with status without moving titles`, async () => {
    await using temporary = await tmpdir()
    const [status, setStatus] = createSignal<SessionTabsStatus>(EMPTY_SESSION_TAB_STATUS)
    const [active, setActive] = createSignal("second")
    const [animations, setAnimations] = createSignal(false)
    const [newTab, setNewTab] = createSignal(false)
    const settings: Info = { tabs: { enabled: true } }
    let config!: ReturnType<typeof useConfig>
    let theme!: ReturnType<typeof useTheme>
    function Colors() {
      config = useConfig()
      theme = orientation === "vertical" ? useTheme("elevated") : useTheme()
      return null
    }
    const controller = {
      tabs: () => [
        { sessionID: "first", title: "First" },
        { sessionID: "second", title: "Second" },
      ],
      current: active,
      newTab,
      select(sessionID: string) {
        batch(() => {
          setActive(sessionID)
          if (sessionID === "first") setStatus((current) => ({ ...current, unread: undefined }))
        })
      },
      close() {},
      move() {},
      detail: () => "project",
      status: (sessionID: string) => (sessionID === "first" ? status() : EMPTY_SESSION_TAB_STATUS),
    } satisfies SessionTabsController
    const app = await testRender(
      () => (
        <TestTuiContexts paths={{ state: temporary.path }}>
          <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
            <StorageProvider>
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
                <RouteProvider initialRoute={{ type: "home" }}>
                  <ClientProvider api={createApi(createFetch(undefined, createEventStream()).fetch)}>
                    <DataProvider directory={temporary.path}>
                      <LocationProvider>
                        <SessionTabsProvider>
                          <ThemeProvider mode="dark" source={emptyThemeSource}>
                            <Colors />
                            <SessionTabs controller={controller} orientation={orientation} animations={animations()} />
                          </ThemeProvider>
                        </SessionTabsProvider>
                      </LocationProvider>
                    </DataProvider>
                  </ClientProvider>
                </RouteProvider>
              </ConfigProvider>
            </StorageProvider>
          </TuiAppProvider>
        </TestTuiContexts>
      ),
      { width: 60, height: 10 },
    )

    try {
      app.renderer.start()
      await app.waitForFrame((frame) => frame.includes("   First") && frame.includes("   Second"))

      const titleColumn = app
        .captureCharFrame()
        .split("\n")
        .find((line) => line.includes("First"))!
        .indexOf("First")
      const states: { status: Partial<SessionTabsStatus>; label: string }[] = [
        { status: { busy: true }, label: SPINNER_FRAMES[0] },
        { status: { busy: true, attention: "question" }, label: "?" },
        { status: { busy: true, attention: "permission" }, label: "!" },
        { status: { unread: "activity" }, label: "\u2022" },
        { status: { unread: "error" }, label: "\u2022" },
        { status: {}, label: "" },
      ]
      for (const state of states) {
        setStatus({ ...EMPTY_SESSION_TAB_STATUS, ...state.status })
        await app.renderOnce()
        await app.waitForFrame((frame) => frame.includes(`${state.label.padStart(2)} First`))
        const rows = app.captureCharFrame().split("\n")
        expect(rows.find((line) => line.includes("First"))!.indexOf("First")).toBe(titleColumn)
        expect(rows[orientation === "vertical" ? 2 : 1]?.trim()).toBe(orientation === "vertical" ? "project" : "")
      }

      for (const attention of ["question", "permission"] as const) {
        setAnimations(false)
        setActive("second")
        setStatus({ ...EMPTY_SESSION_TAB_STATUS, busy: true, attention })
        await app.renderOnce()
        const glow = () => {
          const colors = app
            .captureSpans()
            .lines[
              orientation === "vertical" ? 1 : 0
            ]!.spans.flatMap((span) => Array.from({ length: span.width }, () => span.bg))
          return (
            Math.abs(colors[1]!.r - colors[18]!.r) +
            Math.abs(colors[1]!.g - colors[18]!.g) +
            Math.abs(colors[1]!.b - colors[18]!.b)
          )
        }
        const full = glow()
        expect(full).toBeGreaterThan(0)
        setActive("first")
        await app.renderOnce()
        const dim = glow()
        expect(dim).toBeGreaterThan(0)
        expect(dim).toBeLessThan(full)
        setActive("second")
        await app.renderOnce()
        setAnimations(true)
        await app.renderOnce()
        expect(app.renderer.root.liveCount).toBe(0)

        setActive("first")
        await app.renderOnce()
        expect(app.renderer.root.liveCount).toBe(0)
        await app.waitForFrame(() => glow() > dim && glow() < full)
        await app.waitForFrame(() => glow() === dim, { maxPasses: 60 })
        setActive("second")
        await app.renderOnce()
        expect(app.renderer.root.liveCount).toBe(0)
        await app.waitForFrame(() => glow() > dim && glow() < full)
        await app.waitForFrame(() => glow() === full, { maxPasses: 60 })

        setStatus(EMPTY_SESSION_TAB_STATUS)
        await app.renderOnce()
        expect(app.renderer.root.liveCount).toBeGreaterThan(0)
      }

      const glyph = "\u2022"
      for (const unread of ["activity", "error"] as const) {
        setAnimations(false)
        setActive("second")
        setStatus({ ...EMPTY_SESSION_TAB_STATUS, busy: true })
        await app.renderOnce()
        setAnimations(true)
        setStatus({ ...EMPTY_SESSION_TAB_STATUS, unread })
        await app.renderOnce()
        const color = () =>
          app
            .captureSpans()
            .lines.flatMap((line) => line.spans)
            .find((span) => span.text.trim() === glyph)?.fg
        expect(color()?.toInts()).toEqual(
          (unread === "error" ? theme.text.feedback.error.default : theme.text.status.unread).toInts(),
        )
        const brightness = () => {
          const value = color()
          return value ? value.r + value.g + value.b : undefined
        }
        const initial = brightness()!
        await app.mockMouse.click(1, orientation === "vertical" ? 1 : 0)
        await app.renderOnce()
        expect(active()).toBe("first")
        expect(status().unread).toBeUndefined()
        expect(app.captureCharFrame()).toContain(`${glyph} First`)
        await app.waitForFrame((frame) => frame.includes(`${glyph} First`) && (brightness() ?? -1) > initial)
        const peak = brightness()!
        await app.waitForFrame((frame) => frame.includes(`${glyph} First`) && (brightness() ?? Infinity) < peak)
        await app.waitForFrame((frame) => frame.includes("   First"), { maxPasses: 60 })
      }

      setAnimations(false)
      setStatus({ ...EMPTY_SESSION_TAB_STATUS, unread: "activity" })
      await app.renderOnce()
      setAnimations(true)
      await app.mockMouse.click(1, orientation === "vertical" ? 1 : 0)
      setStatus({ ...EMPTY_SESSION_TAB_STATUS, busy: true })
      await app.waitForFrame((frame) => SPINNER_FRAMES.slice(1).some((glyph) => frame.includes(`${glyph} First`)))
      setStatus({ ...EMPTY_SESSION_TAB_STATUS, busy: true, attention: "question" })
      await app.waitForFrame((frame) => frame.includes("? First"))

      await config.update((draft) => {
        draft.tabs.indicators = "numbers"
      })
      await app.waitForFrame((frame) => frame.includes("1 First") && frame.includes("2 Second"))
      setStatus({ ...EMPTY_SESSION_TAB_STATUS, busy: true })
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("1 First")
      await config.update((draft) => {
        draft.tabs.indicators = "status"
      })
      await app.waitForFrame((frame) => SPINNER_FRAMES.some((glyph) => frame.includes(`${glyph} First`)))

      setNewTab(true)
      await app.waitForFrame((frame) => frame.includes("+ New session"))
    } finally {
      app.renderer.destroy()
    }
  })
}

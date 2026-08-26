/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { batch, createSignal } from "solid-js"
import { ConfigProvider } from "../../src/config"
import {
  EMPTY_SESSION_TAB_STATUS,
  SessionTabs,
  TAB_SPINNERS,
  TAB_UNREAD_MARKERS,
  type SessionTabsController,
  type SessionTabsStatus,
  type TabSpinner,
  type TabUnreadMarker,
} from "../../src/component/session-tabs"
import { ClientProvider } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { LocationProvider } from "../../src/context/location"
import { Keymap } from "../../src/context/keymap"
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
    const [spinner, setSpinner] = createSignal<TabSpinner>("dots")
    const [marker, setMarker] = createSignal<TabUnreadMarker>("small-dot")
    const [newTab, setNewTab] = createSignal(false)
    let theme!: ReturnType<typeof useTheme>
    function Colors() {
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
              <ConfigProvider config={createTuiResolvedConfig({ tabs: { enabled: true } })}>
                <RouteProvider initialRoute={{ type: "home" }}>
                  <ClientProvider api={createApi(createFetch(undefined, createEventStream()).fetch)}>
                    <DataProvider directory={temporary.path}>
                      <LocationProvider>
                        <SessionTabsProvider>
                          <ThemeProvider mode="dark" source={emptyThemeSource}>
                            <Colors />
                            <Keymap.Provider>
                              <SessionTabs
                                controller={controller}
                                orientation={orientation}
                                animations={animations()}
                                spinner={spinner()}
                                unreadMarker={marker()}
                              />
                            </Keymap.Provider>
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
      { width: 60, height: 10, kittyKeyboard: true },
    )

    try {
      app.renderer.start()
      await app.waitForFrame((frame) => frame.includes("   First") && frame.includes("   Second"))
      const pressed = performance.now()
      await app.mockInput.pressKeys(["\x1b[57442;5u"])
      await app.waitForFrame((frame) => frame.includes("1 First") && frame.includes("2 Second"))
      expect(performance.now() - pressed).toBeGreaterThanOrEqual(300)
      await app.mockInput.pressKeys(["\x1b[57442;1:3u"])
      await app.waitForFrame((frame) => frame.includes("   First"))

      await app.mockInput.pressKeys(["\x1b[57442;5u"])
      await app.renderOnce()
      await app.mockInput.pressKeys(["\x1b[57442;1:3u"])
      await Bun.sleep(325)
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("   First")

      const titleColumn = app
        .captureCharFrame()
        .split("\n")
        .find((line) => line.includes("First"))!
        .indexOf("First")
      const states: { status: Partial<SessionTabsStatus>; label: string }[] = [
        { status: { busy: true }, label: TAB_SPINNERS.dots.frames[0] },
        { status: { busy: true, attention: "question" }, label: "?" },
        { status: { busy: true, attention: "permission" }, label: "!" },
        { status: { unread: "activity" }, label: TAB_UNREAD_MARKERS["small-dot"] },
        { status: { unread: "error" }, label: TAB_UNREAD_MARKERS["small-dot"] },
        { status: {}, label: "" },
      ]
      for (const selected of [false, true]) {
        setActive(selected ? "first" : "second")
        for (const state of states) {
          const label = `${state.label.padStart(2)} First`
          setStatus({ ...EMPTY_SESSION_TAB_STATUS, ...state.status })
          await app.renderOnce()
          await app.waitForFrame((frame) => frame.includes(label))
          expect(
            app
              .captureCharFrame()
              .split("\n")
              .find((line) => line.includes("First"))!
              .indexOf("First"),
          ).toBe(titleColumn)
          const rows = app.captureCharFrame().split("\n")
          expect(rows[orientation === "vertical" ? 2 : 1]?.trim()).toBe(orientation === "vertical" ? "project" : "")
          if (state.status.unread) {
            const indicator = app
              .captureSpans()
              .lines.flatMap((line) => line.spans)
              .find((span) => span.text.trim() === state.label)
            expect(indicator).toBeDefined()
            expect(indicator!.fg.toInts()).toEqual(
              (state.status.unread === "error" ? theme.text.feedback.error.default : theme.text.status.unread).toInts(),
            )
          }
          await app.mockInput.pressKeys(["\x1b[57442;5u"])
          await app.waitForFrame((frame) => frame.includes("1 First") && frame.includes("2 Second"))
          // Releasing a chord's digit is not releasing Control.
          await app.mockInput.pressKeys(["\x1b[49;5:3u"])
          await app.renderOnce()
          expect(app.captureCharFrame()).toContain("1 First")
          await app.mockInput.pressKeys(["\x1b[57442;1:3u"])
          await app.waitForFrame((frame) => frame.includes(label))
        }
      }

      setActive("second")
      for (const name of Object.keys(TAB_UNREAD_MARKERS) as TabUnreadMarker[]) {
        setMarker(name)
        for (const unread of ["activity", "error"] as const) {
          setStatus({ ...EMPTY_SESSION_TAB_STATUS, unread })
          await app.renderOnce()
          await app.waitForFrame((frame) => frame.includes(`${TAB_UNREAD_MARKERS[name]} First`))
          expect(
            app
              .captureCharFrame()
              .split("\n")
              .find((line) => line.includes("First"))!
              .indexOf("First"),
          ).toBe(titleColumn)
        }
        setStatus(EMPTY_SESSION_TAB_STATUS)
        await app.waitForFrame((frame) => frame.includes("   First"))
      }

      setMarker("small-dot")
      for (const unread of ["activity", "error"] as const) {
        setAnimations(true)
        setStatus({ ...EMPTY_SESSION_TAB_STATUS, busy: true })
        await app.waitForFrame((frame) => TAB_SPINNERS.dots.frames.some((glyph) => frame.includes(`${glyph} First`)))
        setStatus({ ...EMPTY_SESSION_TAB_STATUS, unread })
        await app.renderOnce()
        const indicator = app
          .captureSpans()
          .lines.flatMap((line) => line.spans)
          .find((span) => span.text.trim() === TAB_UNREAD_MARKERS["small-dot"])
        expect(indicator).toBeDefined()
        expect(indicator!.fg.toInts()).toEqual(
          (unread === "error" ? theme.text.feedback.error.default : theme.text.status.unread).toInts(),
        )
        setAnimations(false)
        setStatus(EMPTY_SESSION_TAB_STATUS)
        await app.renderOnce()
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

      const glyph = TAB_UNREAD_MARKERS["small-dot"]
      setMarker("small-dot")
      for (const unread of ["activity", "error"] as const) {
        setAnimations(false)
        setActive("second")
        setStatus({ ...EMPTY_SESSION_TAB_STATUS, unread })
        await app.renderOnce()
        await app.waitForFrame((frame) => frame.includes(`${glyph} First`))
        const brightness = () => {
          const color = app
            .captureSpans()
            .lines.flatMap((line) => line.spans)
            .find((span) => span.text.trim() === glyph)?.fg
          return color ? color.r + color.g + color.b : undefined
        }
        const initial = brightness()
        expect(initial).toBeDefined()
        setAnimations(true)
        await app.mockMouse.click(1, orientation === "vertical" ? 1 : 0)
        await app.renderOnce()
        expect(active()).toBe("first")
        expect(status().unread).toBeUndefined()
        expect(app.captureCharFrame()).toContain(`${glyph} First`)
        await app.waitForFrame((frame) => frame.includes(`${glyph} First`) && (brightness() ?? -1) > initial!)
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
      await app.waitForFrame((frame) => TAB_SPINNERS.dots.frames.some((glyph) => frame.includes(`${glyph} First`)))
      setStatus(EMPTY_SESSION_TAB_STATUS)
      await app.waitForFrame((frame) => frame.includes("   First"))

      setStatus({ ...EMPTY_SESSION_TAB_STATUS, busy: true })
      setAnimations(true)
      for (const name of Object.keys(TAB_SPINNERS) as TabSpinner[]) {
        setSpinner(name)
        await app.waitForFrame((frame) => TAB_SPINNERS[name].frames.some((glyph) => frame.includes(`${glyph} First`)))
        const first = app.captureCharFrame()
        await app.waitForFrame((frame) => frame !== first)
        await app.mockInput.pressKeys(["\x1b[57448;5u"])
        await app.waitForFrame((frame) => frame.includes("1 First"))
        await app.mockInput.pressKeys(["\x1b[57448;1:3u"])
        await app.waitForFrame((frame) => TAB_SPINNERS[name].frames.some((glyph) => frame.includes(`${glyph} First`)))
      }
      await app.mockInput.pressKeys(["\x1b[57442;5u"])
      setStatus({ ...EMPTY_SESSION_TAB_STATUS, busy: true, attention: "question" })
      await app.waitForFrame((frame) => frame.includes("1 First"))
      app.renderer.emit("blur")
      await app.waitForFrame((frame) => frame.includes("? First"))

      setNewTab(true)
      await app.waitForFrame((frame) => frame.includes("+ New session"))
    } finally {
      app.renderer.destroy()
    }
  })
}

/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { ConfigProvider } from "../../src/config"
import {
  EMPTY_SESSION_TAB_STATUS,
  SessionTabs,
  TAB_SPINNERS,
  type SessionTabsController,
  type SessionTabsStatus,
  type TabSpinner,
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
      select: setActive,
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
                    <DataProvider>
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
      await app.waitForFrame((frame) => frame.includes("1 First") && frame.includes("2 Second"))
      const titleColumn = app
        .captureCharFrame()
        .split("\n")
        .find((line) => line.includes("First"))!
        .indexOf("First")
      const states: { status: Partial<SessionTabsStatus>; label: string }[] = [
        { status: { busy: true }, label: TAB_SPINNERS.dots.frames[0] },
        { status: { busy: true, attention: "question" }, label: "?" },
        { status: { busy: true, attention: "permission" }, label: "!" },
        { status: { unread: "activity" }, label: "1" },
        { status: { unread: "error" }, label: "1" },
        { status: {}, label: "1" },
      ]
      for (const selected of [false, true]) {
        setActive(selected ? "first" : "second")
        for (const state of states) {
          setStatus({ ...EMPTY_SESSION_TAB_STATUS, ...state.status })
          await app.renderOnce()
          await app.waitForFrame((frame) => frame.includes(`${state.label} First`))
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
            const number = app
              .captureSpans()
              .lines.flatMap((line) => line.spans)
              .find((span) => span.text.trim() === "1")
            expect(number).toBeDefined()
            expect(number!.fg.toInts()).toEqual(
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
          await app.waitForFrame((frame) => frame.includes(`${state.label} First`))
        }
      }

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
    } finally {
      app.renderer.destroy()
    }
  })
}

/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { MigrationOverlay } from "../../src/component/migration-overlay"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { Toast, ToastProvider } from "../../src/ui/toast"
import { createApi, createEventStream, createFetch, json } from "../fixture/tui-client"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const migration = "/experimental/migration/v1"

async function mount(fetch: typeof globalThis.fetch) {
  const temporary = await tmpdir()
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <ClientProvider api={createApi(fetch)}>
                  <MigrationOverlay />
                  <Toast />
                </ClientProvider>
              </ToastProvider>
            </Keymap.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  )
  return { app, temporary }
}

test("a 503 while the service boots is retried instead of reported as a failed migration", async () => {
  let calls = 0
  const callsFetch = createFetch((url) => {
    if (!url.pathname.endsWith(migration)) return
    calls++
    if (calls <= 2) return new Response("Service Unavailable", { status: 503 })
    return json({ status: "completed" })
  }, createEventStream())
  const { app, temporary } = await mount(callsFetch.fetch)

  try {
    app.renderer.start()
    await Bun.sleep(4_000)
    expect(calls).toBeGreaterThanOrEqual(3)
    expect(app.captureCharFrame()).not.toContain("Data migration failed")
  } finally {
    app.renderer.destroy()
    await temporary[Symbol.asyncDispose]()
  }
})

test("a migration error the endpoint reports is still shown", async () => {
  const callsFetch = createFetch((url) => {
    if (!url.pathname.endsWith(migration)) return
    return json({ status: "error", error: "migration exploded" })
  }, createEventStream())
  const { app, temporary } = await mount(callsFetch.fetch)

  try {
    app.renderer.start()
    await Bun.sleep(2_000)
    const frame = app.captureCharFrame()
    expect(frame).toContain("Data migration failed")
    expect(frame).toContain("migration exploded")
  } finally {
    app.renderer.destroy()
    await temporary[Symbol.asyncDispose]()
  }
})

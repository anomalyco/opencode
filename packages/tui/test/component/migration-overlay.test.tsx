/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ConfigProvider } from "../../src/config"
import { MigrationOverlay } from "../../src/component/migration-overlay"
import { ClientProvider } from "../../src/context/client"
import { ThemeProvider } from "../../src/context/theme"
import { ToastProvider, useToast, type ToastContext } from "../../src/ui/toast"
import { emptyThemeSource } from "../fixture/fixture"
import { createApi, createEventStream, createFetch, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const starting = () => json({ code: "service_starting" }, { status: 503, headers: { "retry-after": "1" } })

async function mount(responses: Array<() => Response>) {
  const polls = { count: 0 }
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/experimental/migration/v1") return undefined
    const response = responses[Math.min(polls.count, responses.length - 1)]
    polls.count++
    return response()
  }, createEventStream())
  const state = {} as { toast?: ToastContext }

  function Probe() {
    state.toast = useToast()
    return null
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <ToastProvider>
              <Probe />
              <MigrationOverlay interval={1} />
            </ToastProvider>
          </ThemeProvider>
        </ConfigProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))
  return { app, polls, toast: () => state.toast?.currentToast ?? null }
}

async function until(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

test("retries transient failures while the server boots", async () => {
  const setup = await mount([
    starting,
    () => {
      throw new Error("ECONNRESET")
    },
    starting,
    () => json({ status: "completed" }),
  ])
  try {
    await until(() => setup.polls.count === 4)
    await Bun.sleep(50)
    expect(setup.polls.count).toBe(4)
    expect(setup.toast()).toBeNull()
  } finally {
    setup.app.renderer.destroy()
  }
})

test("reports a migration error from the status", async () => {
  const setup = await mount([starting, () => json({ status: "error", error: "disk full" })])
  try {
    await until(() => setup.toast() !== null)
    expect(setup.toast()).toMatchObject({ title: "Data migration failed", message: "disk full" })
    expect(setup.polls.count).toBe(2)
  } finally {
    setup.app.renderer.destroy()
  }
})

test("reports failure once transient retries run out", async () => {
  const setup = await mount([starting])
  try {
    await until(() => setup.toast() !== null, 5000)
    expect(setup.toast()?.title).toBe("Data migration failed")
    expect(setup.polls.count).toBe(31)
  } finally {
    setup.app.renderer.destroy()
  }
})

test("stops polling after unmount", async () => {
  const setup = await mount([starting])
  await until(() => setup.polls.count > 0)
  setup.app.renderer.destroy()
  const count = setup.polls.count
  await Bun.sleep(50)
  expect(setup.polls.count).toBe(count)
})

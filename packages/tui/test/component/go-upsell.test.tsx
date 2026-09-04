/** @jsxImportSource @opentui/solid */
import type { OpenCodeEvent } from "@opencode-ai/client"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import path from "node:path"
import { createSignal, onCleanup } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { ClientProvider, useClient } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { Keymap } from "../../src/context/keymap"
import { TuiAppProvider } from "../../src/context/runtime"
import { StorageProvider, useStorage } from "../../src/context/storage"
import { ThemeProvider } from "../../src/context/theme"
import { useGoUpsell } from "../../src/routes/session/go-upsell"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { DialogConfirm } from "../../src/ui/dialog-confirm"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { createApi, createEventStream, createFetch, directory } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

async function renderUpsell(root: string, width = 100, animations = true) {
  const events = createEventStream()
  const [session, setSession] = createSignal("ses_current")
  let dialog!: ReturnType<typeof useDialog>
  let storage!: ReturnType<typeof useStorage>
  let client!: ReturnType<typeof useClient>
  let received = 0
  let sequence = 0

  function Probe() {
    dialog = useDialog()
    storage = useStorage()
    client = useClient()
    useGoUpsell(session)
    onCleanup(useData().on("session.execution.failed", () => received++))
    return <text>Session content</text>
  }

  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: root }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ConfigProvider config={createTuiResolvedConfig({ animations })}>
              <ClientProvider api={createApi(createFetch(undefined, events).fetch)}>
                <DataProvider directory={directory}>
                  <ThemeProvider mode={width === 40 ? "light" : "dark"} source={emptyThemeSource}>
                    <Keymap.Provider>
                      <ToastProvider>
                        <DialogProvider>
                          <Probe />
                        </DialogProvider>
                      </ToastProvider>
                    </Keymap.Provider>
                  </ThemeProvider>
                </DataProvider>
              </ClientProvider>
            </ConfigProvider>
          </StorageProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    { width, height: 24, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.waitFor(() => client.connection.status() === "connected")

  return {
    app,
    dialog,
    setSession,
    async fail(sessionID = session(), type = "provider.free-tier-limit") {
      const count = received + 1
      // Execution failures are server-wide events, without a location envelope.
      events.emit({
        id: `evt_failure_${++sequence}`,
        created: Date.now(),
        type: "session.execution.failed",
        durable: { aggregateID: sessionID, seq: sequence, version: 1 },
        data: { sessionID, error: { type, message: "Free usage limit reached", status: 429 } },
      } satisfies OpenCodeEvent)
      await app.waitFor(() => received === count)
      await app.renderOnce()
    },
    async persisted() {
      await storage.flush()
      return Bun.file(path.join(root, "test", "tui", "go-upsell.json")).json()
    },
    async age(milliseconds: number) {
      const [, update] = storage.store("go-upsell", { initial: { lastSeenAt: 0, dontShowAgain: false } })
      await update((draft) => {
        draft.lastSeenAt = Date.now() - milliseconds
      })
    },
    async [Symbol.asyncDispose]() {
      dialog.clear()
      await storage.flush()
      app.renderer.destroy()
    },
  }
}

for (const [width, animations] of [
  [40, true],
  [100, true],
  [100, false],
] as const) {
  test(`server-wide free-limit event renders the Go offer at ${width} columns with animations ${animations}`, async () => {
    await using temporary = await tmpdir()
    await using setup = await renderUpsell(temporary.path, width, animations)
    await setup.fail()

    const frame = setup.app.captureCharFrame()
    expect(frame).toContain("Free limit reached")
    expect(frame).toContain("Subscribe")
    expect(frame).toContain("Don't show again")
    expect(frame).not.toContain("Don'T")
    expect(frame.replace(/\s/g, "")).toContain("$5/month")
    expect(frame).toContain("https://opencode.ai/go")
    expect(frame).toContain("▀")
    expect(frame.split("\n").find((line) => line.includes("Free limit reached"))).toContain("esc")
    expect(setup.dialog.stack).toHaveLength(1)
  })
}

for (const shift of [false, true]) {
  test(`${shift ? "Shift+Tab" : "Tab"} selects Don't show again`, async () => {
    await using temporary = await tmpdir()
    await using setup = await renderUpsell(temporary.path)
    await setup.fail()
    setup.app.mockInput.pressTab({ shift })
    setup.app.mockInput.pressEnter()
    await setup.app.waitFor(() => setup.dialog.stack.length === 0)
    expect((await setup.persisted()).dontShowAgain).toBe(true)
  })
}

test("only the current session's exact free-tier error opens the offer", async () => {
  await using temporary = await tmpdir()
  await using setup = await renderUpsell(temporary.path)
  await setup.fail("ses_other")
  await setup.fail("ses_current", "provider.rate-limit")
  await setup.fail("ses_current", "unknown")
  expect(setup.dialog.stack).toHaveLength(0)
  expect(setup.app.captureCharFrame()).not.toContain("Free limit reached")

  setup.setSession("ses_next")
  await setup.fail("ses_current")
  expect(setup.dialog.stack).toHaveLength(0)
  await setup.fail("ses_next")
  expect(setup.app.captureCharFrame()).toContain("Free limit reached")
})

test("does not replace another modal or recreate an already open offer", async () => {
  await using temporary = await tmpdir()
  await using setup = await renderUpsell(temporary.path)
  setup.dialog.replace(() => <DialogConfirm title="Keep working" message="An existing dialog" />)
  const existing = setup.dialog.stack[0]
  await setup.fail()
  expect(setup.dialog.stack[0]).toBe(existing)
  expect(setup.app.captureCharFrame()).toContain("Keep working")
  expect(setup.app.captureCharFrame()).toContain("Cancel  Confirm")
  expect(setup.app.captureCharFrame()).not.toContain("Free limit reached")

  setup.app.mockInput.pressEscape()
  await setup.fail()
  const offer = setup.dialog.stack[0]
  expect(setup.app.captureCharFrame()).toContain("Free limit reached")
  await setup.fail()
  expect(setup.dialog.stack).toHaveLength(1)
  expect(setup.dialog.stack[0]).toBe(offer)
  expect(await Bun.file(path.join(temporary.path, "test", "tui", "go-upsell.json")).exists()).toBe(false)
})

test("Escape persists a cooldown across remounts without opting out and permits another offer after 24h", async () => {
  await using temporary = await tmpdir()
  {
    await using setup = await renderUpsell(temporary.path)
    await setup.fail()
    const before = Date.now()
    setup.app.mockInput.pressEscape()
    await setup.app.waitFor(() => setup.dialog.stack.length === 0)
    const saved = await setup.persisted()
    expect(saved.dontShowAgain).toBe(false)
    expect(saved.lastSeenAt).toBeGreaterThanOrEqual(before)
    expect(saved.lastSeenAt).toBeLessThanOrEqual(Date.now())
    await setup.fail()
    expect(setup.dialog.stack).toHaveLength(0)
  }

  await using setup = await renderUpsell(temporary.path)
  await setup.fail()
  expect(setup.dialog.stack).toHaveLength(0)
  await setup.age(23 * 60 * 60 * 1000)
  await setup.fail()
  expect(setup.dialog.stack).toHaveLength(0)
  await setup.age(24 * 60 * 60 * 1000)
  await setup.fail()
  expect(setup.app.captureCharFrame()).toContain("Free limit reached")
})

for (const input of ["keyboard", "pointer"]) {
  test(`Don't show again via ${input} survives a remount beyond the cooldown`, async () => {
    await using temporary = await tmpdir()
    {
      await using setup = await renderUpsell(temporary.path)
      await setup.fail()
      if (input === "keyboard") {
        setup.app.mockInput.pressArrow("right")
        setup.app.mockInput.pressEnter()
      }
      if (input === "pointer") {
        const lines = setup.app.captureCharFrame().split("\n")
        const row = lines.findIndex((line) => line.includes("Don't show again"))
        expect(row).toBeGreaterThanOrEqual(0)
        await setup.app.mockMouse.click(lines[row].indexOf("Don't show again"), row)
      }
      await setup.app.waitFor(() => setup.dialog.stack.length === 0)
      expect((await setup.persisted()).dontShowAgain).toBe(true)
      await setup.age(7 * 24 * 60 * 60 * 1000)
    }

    await using setup = await renderUpsell(temporary.path)
    await setup.fail()
    setup.setSession("ses_next")
    await setup.fail()
    expect(setup.dialog.stack).toHaveLength(0)
    expect(setup.app.captureCharFrame()).not.toContain("Free limit reached")
    expect((await setup.persisted()).dontShowAgain).toBe(true)
  })
}

test.skipIf(process.platform !== "linux")(
  "Subscribe opens the Go URL and starts a cooldown without opting out",
  async () => {
    await using temporary = await tmpdir()
    const original = {
      BROWSER: process.env.BROWSER,
      XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP,
      GO_UPSELL_BROWSER_LOG: process.env.GO_UPSELL_BROWSER_LOG,
    }
    process.env.BROWSER = `sh ${path.join(import.meta.dir, "../fixture/go-upsell-browser.sh")} %s`
    process.env.XDG_CURRENT_DESKTOP = "X-Generic"
    process.env.GO_UPSELL_BROWSER_LOG = path.join(temporary.path, "opened-url")
    try {
      await using setup = await renderUpsell(temporary.path)
      await setup.fail()
      setup.app.mockInput.pressEnter()
      await setup.app.waitFor(() => setup.dialog.stack.length === 0)
      await setup.app.waitFor(() => Bun.file(path.join(temporary.path, "opened-url")).exists())
      expect(await Bun.file(path.join(temporary.path, "opened-url")).text()).toBe("https://opencode.ai/go\n")
      const saved = await setup.persisted()
      expect(saved.lastSeenAt).toBeGreaterThan(0)
      expect(saved.dontShowAgain).toBe(false)
      await setup.fail()
      expect(setup.dialog.stack).toHaveLength(0)
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]
        if (value !== undefined) process.env[key] = value
      }
    }
  },
)

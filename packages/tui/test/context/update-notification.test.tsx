/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { ExitProvider } from "../../src/context/exit"
import { Keymap } from "../../src/context/keymap"
import { TuiAppProvider } from "../../src/context/runtime"
import { StorageProvider } from "../../src/context/storage"
import { ThemeProvider } from "../../src/context/theme"
import {
  UpdateNotificationProvider,
  useUpdateNotification,
  type UpdateSource,
} from "../../src/context/update-notification"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { createApi, createFetch } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

for (const origin of ["manual", "notification"] as const) {
  for (const [previous, latest] of [
    ["2.0.18", "2.0.21"],
    ["2.0.18", "2.1.0"],
    ["0.0.0-dev-20360", "0.0.0-dev-20364"],
  ]) {
    test(`${origin} update checks again before installing ${latest} instead of ${previous}`, async () => {
      const checked = Promise.withResolvers<Awaited<ReturnType<UpdateSource["check"]>>>()
      const installed: string[] = []
      const setup = await render({
        remote: false,
        subscribe: async (notify) => notify({ type: "available", version: previous }),
        check: async () => checked.promise,
        apply: async (version) => void installed.push(version),
      })

      try {
        await setup.app.waitForFrame((frame) => frame.includes(previous))
        setup.update()?.open?.(origin)
        await setup.app.waitForFrame((frame) => frame.includes("Checking for updates"))
        expect(setup.app.captureCharFrame()).not.toContain("Update available")
        checked.resolve({ type: "available", version: latest })
        await setup.app.waitForFrame((frame) => frame.includes("An update is available"))
        setup.app.mockInput.pressKey("RETURN")
        await setup.app.waitForFrame((frame) => frame.includes("Update successful"))
        expect(installed).toEqual([latest])
        expect(setup.update()?.notification()).toMatchObject({ type: "installed", version: latest })
      } finally {
        checked.resolve(undefined)
        setup.app.renderer.destroy()
        await setup.temporary[Symbol.asyncDispose]()
      }
    })
  }
}

test("a failed fresh check never installs the version from an old notice", async () => {
  const installed: string[] = []
  const setup = await render({
    remote: false,
    subscribe: async (notify) => notify({ type: "available", version: "2.0.18" }),
    check: async () => {
      throw new Error("Update service unavailable")
    },
    apply: async (version) => void installed.push(version),
  })

  try {
    await setup.app.waitForFrame((frame) => frame.includes("2.0.18"))
    setup.update()?.open?.("manual")
    await setup.app.waitForFrame((frame) => frame.includes("Update service unavailable"))
    setup.app.mockInput.pressKey("RETURN")
    expect(installed).toEqual([])
  } finally {
    setup.app.renderer.destroy()
    await setup.temporary[Symbol.asyncDispose]()
  }
})

test("a fresh check that finds no update clears the stale client notification", async () => {
  const installed: string[] = []
  const setup = await render({
    remote: false,
    subscribe: async (notify) => notify({ type: "available", version: "2.0.18" }),
    check: async () => undefined,
    apply: async (version) => void installed.push(version),
  })

  try {
    await setup.app.waitForFrame((frame) => frame.includes("2.0.18"))
    setup.update()?.open?.("manual")
    await setup.app.waitForFrame((frame) => frame.includes("already up to date"))
    expect(setup.update()?.notification()).toBeUndefined()
    expect(installed).toEqual([])
  } finally {
    setup.app.renderer.destroy()
    await setup.temporary[Symbol.asyncDispose]()
  }
})

test("an automatically installed update still prompts for restart without checking again", async () => {
  let checks = 0
  const setup = await render({
    remote: false,
    subscribe: async (notify) => notify({ type: "installed", version: "2.0.21" }),
    check: async () => {
      checks++
      return undefined
    },
    apply: async () => {},
  })

  try {
    await setup.app.waitForFrame((frame) => frame.includes("2.0.21"))
    setup.update()?.open?.("manual")
    await setup.app.waitForFrame((frame) => frame.includes("Update successful"))
    expect(checks).toBe(0)
  } finally {
    setup.app.renderer.destroy()
    await setup.temporary[Symbol.asyncDispose]()
  }
})

async function render(updater: UpdateSource) {
  const temporary = await tmpdir()
  let update: ReturnType<typeof useUpdateNotification> | undefined
  function Capture() {
    update = useUpdateNotification()
    return <text>{update.notification()?.version ?? "none"}</text>
  }
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <TuiAppProvider value={{ name: "cli", channel: "latest", version: "2.0.16" }}>
          <ConfigProvider config={createTuiResolvedConfig()}>
            <ClientProvider api={createApi(createFetch().fetch)}>
              <StorageProvider>
                <ExitProvider exit={() => {}}>
                  <ThemeProvider mode="dark" source={emptyThemeSource}>
                    <Keymap.Provider>
                      <ToastProvider>
                        <DialogProvider>
                          <UpdateNotificationProvider updater={updater}>
                            <Capture />
                          </UpdateNotificationProvider>
                        </DialogProvider>
                      </ToastProvider>
                    </Keymap.Provider>
                  </ThemeProvider>
                </ExitProvider>
              </StorageProvider>
            </ClientProvider>
          </ConfigProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  )
  app.renderer.start()
  return { app, temporary, update: () => update }
}

/** @jsxImportSource @opentui/solid */
import { InputRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import { DialogVariant } from "../../../src/component/dialog-variant"
import { ArgsProvider } from "../../../src/context/args"
import { ExitProvider } from "../../../src/context/exit"
import { KVProvider } from "../../../src/context/kv"
import { LocalProvider, useLocal } from "../../../src/context/local"
import { PermissionProvider } from "../../../src/context/permission"
import { ProjectProvider } from "../../../src/context/project"
import { RouteProvider } from "../../../src/context/route"
import { SDKProvider } from "../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../src/context/sync"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../../fixture/tui-sdk"
import { wait } from "../cmd/tui/sync-fixture"

test.each([{ variants: ["default", "high"] }, { variants: ["low", "high"] }])(
  "variant menu has one default choice with %j",
  async (input) => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const file = Bun.file(`${tmp.path}/model.json`)
    await file.write(JSON.stringify({ variant: { "test/model": "default" } }))
    async function persisted(value: string) {
      const start = Date.now()
      while ((await file.json()).variant?.["test/model"] !== value) {
        if (Date.now() - start > 2000) throw new Error("timed out waiting for variant persistence")
        await Bun.sleep(10)
      }
    }
    const events = createEventSource()
    const calls = createFetch((url) => {
      if (url.pathname === "/agent") return json([{ name: "build", mode: "primary", hidden: false }])
      if (url.pathname === "/config/providers")
        return json({
          providers: [
            {
              id: "test",
              models: { model: { id: "model", variants: Object.fromEntries(input.variants.map((v) => [v, {}])) } },
            },
          ],
          default: { test: "model" },
        })
      return undefined
    }, events)
    let local!: ReturnType<typeof useLocal>
    let sync!: ReturnType<typeof useSync>
    let dialog!: ReturnType<typeof useDialog>

    function Probe() {
      local = useLocal()
      sync = useSync()
      dialog = useDialog()
      return <box />
    }

    function Harness() {
      const renderer = useRenderer()
      const keymap = createDefaultOpenTuiKeymap(renderer)
      const config = createTuiResolvedConfig({})
      onCleanup(registerOpencodeKeymap(keymap, renderer, config))
      return (
        <TestTuiContexts paths={{ state: tmp.path }}>
          <ArgsProvider>
            <OpencodeKeymapProvider keymap={keymap}>
              <TuiConfigProvider config={config}>
                <KVProvider>
                  <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
                    <PermissionProvider>
                      <ProjectProvider>
                        <ExitProvider exit={() => {}}>
                          <SyncProvider>
                            <ThemeProvider mode="dark">
                              <ToastProvider>
                                <RouteProvider>
                                  <LocalProvider>
                                    <DialogProvider>
                                      <Probe />
                                    </DialogProvider>
                                  </LocalProvider>
                                </RouteProvider>
                              </ToastProvider>
                            </ThemeProvider>
                          </SyncProvider>
                        </ExitProvider>
                      </ProjectProvider>
                    </PermissionProvider>
                  </SDKProvider>
                </KVProvider>
              </TuiConfigProvider>
            </OpencodeKeymapProvider>
          </ArgsProvider>
        </TestTuiContexts>
      )
    }

    const app = await testRender(() => <Harness />, { width: 90, height: 30, kittyKeyboard: true })
    try {
      await wait(() => sync?.status === "complete")
      expect(local.model.variant.list()).toEqual([...input.variants])
      await wait(() => local.model.variant.selected() === "default")
      dialog.replace(() => <DialogVariant />)
      await wait(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
      await app.renderOnce()
      expect(app.captureCharFrame().match(/default/gi)).toHaveLength(1)
      app.mockInput.pressArrow("down")
      app.mockInput.pressEnter()
      expect(local.model.variant.selected()).toBe(input.variants.filter((v) => v !== "default")[0])
      await persisted(input.variants.filter((v) => v !== "default")[0])
      dialog.replace(() => <DialogVariant />)
      await wait(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
      app.mockInput.pressArrow("up")
      app.mockInput.pressEnter()
      expect(local.model.variant.selected()).toBe("default")
      await persisted("default")
    } finally {
      app.renderer.destroy()
    }
  },
)

/** @jsxImportSource @opentui/solid */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "../../../src/cli/cmd/tui/ui/dialog-select"
import { TuiConfigProvider } from "../../../src/cli/cmd/tui/context/tui-config"
import { KVProvider } from "../../../src/cli/cmd/tui/context/kv"
import { ThemeProvider } from "../../../src/cli/cmd/tui/context/theme"
import { ToastProvider } from "../../../src/cli/cmd/tui/ui/toast"
import { DialogProvider } from "../../../src/cli/cmd/tui/ui/dialog"
import { KeybindProvider } from "../../../src/cli/cmd/tui/context/keybind"
import type { TuiConfig } from "../../../src/config/tui"

let view: Awaited<ReturnType<typeof testRender>>
let setOpts: ((value: DialogSelectOption<string>[]) => void) | undefined
let setSwap: ((value: boolean) => void) | undefined

const cfg: TuiConfig.Info = {
  keybinds: {},
}

function App() {
  const [opts, next] = createSignal<DialogSelectOption<string>[]>([])
  const [swap, show] = createSignal(false)
  setOpts = next
  setSwap = show

  const Select = () => <DialogSelect title="Commands" options={opts()} />

  return (
    <TuiConfigProvider config={cfg}>
      <KVProvider>
        <ThemeProvider mode="dark">
          <ToastProvider>
            <DialogProvider>
              <KeybindProvider>
                <Show when={swap()} fallback={<Select />}>
                  <Select />
                </Show>
              </KeybindProvider>
            </DialogProvider>
          </ToastProvider>
        </ThemeProvider>
      </KVProvider>
    </TuiConfigProvider>
  )
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    await view.renderOnce()
    await Bun.sleep(0)
  }
}

async function load(opts: DialogSelectOption<string>[]) {
  setSwap?.(false)
  setOpts?.([])
  await settle()
  setOpts?.(opts)
  setSwap?.(true)
  await settle()
}

describe("command dialog", () => {
  beforeAll(async () => {
    view = await testRender(() => <App />, { width: 60, height: 18 })
    await settle()
  })

  afterAll(() => {
    if (!view?.renderer.isDestroyed) {
      view.renderer.destroy()
    }
  })

  test("keeps a later command visible while moving down", async () => {
    await load([
      { title: "Open editor", value: "prompt.editor" },
      { title: "Session", value: "session.list" },
      { title: "Model", value: "model.list" },
      { title: "Theme", value: "theme.switch" },
      { title: "Help", value: "help.show" },
      { title: "Open editor later", value: "prompt.editor.later" },
    ])

    expect(view.captureCharFrame()).not.toContain("Open editor later")

    for (let i = 0; i < 5; i++) {
      view.mockInput.pressArrow("down")
      await settle()
    }

    expect(view.captureCharFrame()).toContain("Open editor later")
  })

  test("keeps a later duplicate command visible while moving down", async () => {
    await load([
      { title: "Open editor", value: "prompt.editor" },
      { title: "Session", value: "session.list" },
      { title: "Model", value: "model.list" },
      { title: "Theme", value: "theme.switch" },
      { title: "Help", value: "help.show" },
      { title: "Open editor later", value: "prompt.editor" },
    ])

    expect(view.captureCharFrame()).not.toContain("Open editor later")

    for (let i = 0; i < 5; i++) {
      view.mockInput.pressArrow("down")
      await settle()
    }

    expect(view.captureCharFrame()).toContain("Open editor later")
  })
})

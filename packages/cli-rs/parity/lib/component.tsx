/** @jsxImportSource @opentui/solid */
// P-COMP, TypeScript side: renders one TUI component in createTestRenderer at a fixed size and theme and
// writes its cells to parity/fixtures/<fixture>.json (format in cells.ts). Run each component script
// from parity/ so bun picks up parity/bunfig.toml, for example `bun run component/H.1-alert.tsx`.
// The Rust side compares a TestApp capture with the file through opencode_parity::assert_fixture.
import { testRender } from "@opentui/solid"
import { onMount, type JSX } from "solid-js"
import { ConfigProvider } from "../../../tui/src/config"
import { ClientProvider } from "../../../tui/src/context/client"
import { DataProvider } from "../../../tui/src/context/data"
import { Keymap } from "../../../tui/src/context/keymap"
import { LocationProvider } from "../../../tui/src/context/location"
import { RouteProvider } from "../../../tui/src/context/route"
import { ThemeProvider } from "../../../tui/src/context/theme"
import { DialogProvider, useDialog } from "../../../tui/src/ui/dialog"
import { ToastProvider } from "../../../tui/src/ui/toast"
import { emptyThemeSource } from "../../../tui/test/fixture/fixture"
import { createApi, createEventStream, createFetch } from "../../../tui/test/fixture/tui-client"
import { TestTuiContexts } from "../../../tui/test/fixture/tui-environment"
import { createTuiResolvedConfig } from "../../../tui/test/fixture/tui-runtime"
import { withNewDesigns } from "./app"
import { readCells, writeFixture } from "./cells"

type Setup = Awaited<ReturnType<typeof testRender>>

export type ComponentOptions = {
  // Path under parity/fixtures without ".json", for example "U.3/alert".
  fixture: string
  width: number
  height: number
  // More `cli.json` fields for the resolved config, merged over the theme and `animations: false`.
  config?: Record<string, unknown>
  // A built-in theme name; default "opencode".
  theme?: string
  mode?: "dark" | "light"
  // Opened with useDialog().replace once mounted. Use for dialog kinds.
  dialog?: () => JSX.Element
  // Rendered inside the TUI providers (theme, keymap, dialog, toast, data, route).
  element?: () => JSX.Element
  // Rendered with no providers at all, for plain OpenTUI elements.
  bare?: () => JSX.Element
  // The frame text the capture waits for; default any non-blank frame.
  ready?: (frame: string) => boolean
  // Runs after the first ready frame, for example to send keys; the capture waits for the frame to settle again.
  act?: (setup: Setup) => Promise<void> | void
}

export async function renderComponent(options: ComponentOptions) {
  const setup = await testRender(options.bare ?? (() => <Providers {...options} />), {
    width: options.width,
    height: options.height,
    kittyKeyboard: true,
  })
  try {
    const ready = options.ready ?? ((frame: string) => frame.trim().length > 0)
    await settle(setup, ready)
    if (options.act) {
      await options.act(setup)
      await settle(setup, ready)
    }
    const fixture = readCells(setup.renderer.currentRenderBuffer)
    const path = new URL(`../fixtures/${options.fixture}.json`, import.meta.url).pathname
    await writeFixture(path, fixture)
    console.log(`component: ${options.fixture} ${fixture.width}x${fixture.height}`)
    return fixture
  } finally {
    setup.renderer.destroy()
  }
}

function Providers(props: ComponentOptions) {
  const api = createApi(createFetch(undefined, createEventStream()).fetch)
  const config = createTuiResolvedConfig(
    withNewDesigns({
      theme: { name: props.theme ?? "opencode", mode: props.mode ?? "dark" },
      animations: false,
      ...props.config,
    }),
  )
  return (
    <TestTuiContexts>
      <ConfigProvider config={config}>
        <RouteProvider initialRoute={{ type: "home" }}>
          <ClientProvider api={api}>
            <DataProvider directory="/tmp/opencode">
              <LocationProvider>
                <ThemeProvider mode={props.mode ?? "dark"} source={emptyThemeSource}>
                  <Keymap.Provider>
                    <ToastProvider>
                      <DialogProvider>
                        {props.dialog ? <OpenDialog dialog={props.dialog} /> : props.element?.()}
                      </DialogProvider>
                    </ToastProvider>
                  </Keymap.Provider>
                </ThemeProvider>
              </LocationProvider>
            </DataProvider>
          </ClientProvider>
        </RouteProvider>
      </ConfigProvider>
    </TestTuiContexts>
  )
}

function OpenDialog(props: { dialog: () => JSX.Element }) {
  const dialog = useDialog()
  onMount(() => dialog.replace(props.dialog))
  return null
}

// The renderer is not started, so frames come only from renderOnce. Poll with a wall-clock deadline until
// the frame is ready and two frames in a row are equal (theme discovery and dialog focus resolve on timers).
async function settle(setup: Setup, ready: (frame: string) => boolean) {
  const deadline = Date.now() + 3_000
  let previous: string | undefined
  while (Date.now() < deadline) {
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    if (ready(frame) && frame === previous) return
    previous = frame
    await Bun.sleep(10)
  }
  throw new Error(`component: no settled ready frame within 3s; last frame:\n${previous}`)
}

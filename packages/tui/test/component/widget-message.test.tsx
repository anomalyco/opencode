import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import {
  cached,
  WidgetBackendProvider,
  type WidgetBackend,
  type WidgetInfo,
  type WidgetResponse,
} from "../../src/component/widget/backend"
import { createWidgetFocus, WidgetMessage } from "../../src/component/widget/message"
import {
  widgetFixtureMessage,
  type WidgetFixtureName,
} from "../../src/feature-plugins/system/storybook/widget.fixtures"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

async function render(
  name: WidgetFixtureName,
  options: { width?: number; status?: WidgetInfo["status"]; program?: WidgetBackend["program"] } = {},
) {
  const responses: WidgetResponse[] = []
  const [message, setMessage] = createSignal(widgetFixtureMessage(name, options.status))
  const backend: WidgetBackend = {
    program: options.program ?? ((template) => cached(template, () => Promise.reject(new Error("not a built-in")))),
    async respond(input) {
      responses.push(input.response)
      setMessage((current) => ({
        ...current,
        status: "dismiss" in input.response ? "dismissed" : "submitted",
        ...("value" in input.response ? { response: input.response.value } : {}),
      }))
    },
    async send() {},
  }
  function Harness() {
    const focus = createWidgetFocus(() => [message()])
    return <WidgetMessage message={message()} focus={focus} />
  }
  const setup = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
              <ToastProvider>
                <DialogProvider>
                  <WidgetBackendProvider backend={backend}>
                    <Harness />
                  </WidgetBackendProvider>
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: options.width ?? 100, height: 48, kittyKeyboard: true },
  )
  return { ...setup, responses, message, [Symbol.dispose]: () => setup.renderer.destroy() }
}

async function frame(setup: Awaited<ReturnType<typeof render>>, matches: (frame: string) => boolean) {
  const started = Date.now()
  while (Date.now() - started < 3_000) {
    await setup.renderOnce()
    const current = setup.captureCharFrame()
    if (matches(current)) return current
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for widget frame:\n${setup.captureCharFrame()}`)
}

test.each([100, 44])("suggestions render cards and page carousels at width %i", async (width) => {
  using setup = await render("suggestions", { width })
  const first = await frame(setup, (current) => current.includes("Which cabin should we book?"))
  expect(first).toContain("Lakeside")
  expect(first).toContain("1/2")
})

test("a live widget points to desktop and mobile instead of running", async () => {
  using setup = await render("confirm", { program: async () => ({ program: "", mode: "live" }) })
  const current = await frame(setup, (current) => current.includes("Open this widget on desktop or mobile."))
  expect(current).not.toContain("Confirm")
})

test("form renders every field kind", async () => {
  using setup = await render("form")
  const current = await frame(setup, (current) => current.includes("Start release"))
  expect(current).toContain("Rollout percentage")
  expect(current).toContain("[✓] Notify subscribers")
})

test("suggestions submit the picked card with a note", async () => {
  using setup = await render("suggestions")
  await frame(setup, (current) => current.includes("Which cabin should we book?"))
  setup.mockInput.pressArrow("right")
  await frame(setup, (current) => current.includes("2/2"))
  setup.mockInput.pressTab()
  setup.mockInput.pressEnter()
  await frame(setup, (current) => current.includes("✓"))
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  await setup.renderOnce()
  await setup.mockInput.typeText("quiet please")
  setup.mockInput.pressEnter()
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  const done = await frame(setup, (current) => current.includes("Submitted"))
  expect(setup.responses).toEqual([{ value: { choice: "Forest loft", index: 1, note: "quiet please" } }])
  // The answering client keeps its final view, read-only.
  expect(done).toContain("quiet please")
  expect(done).not.toContain("esc prompt")
})

test("form steps the slider, toggles fields and submits", async () => {
  using setup = await render("form")
  await frame(setup, (current) => current.includes("Start release"))
  setup.mockInput.pressTab()
  setup.mockInput.pressArrow("right")
  setup.mockInput.pressArrow("right")
  await frame(setup, (current) => current.includes("35 (0–100)"))
  setup.mockInput.pressTab()
  setup.mockInput.pressKey(" ")
  await frame(setup, (current) => current.includes("[ ] Notify subscribers"))
  setup.mockInput.pressTab()
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await frame(setup, (current) => current.includes("● Beta"))
  setup.mockInput.pressTab()
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressKey(" ")
  await frame(setup, (current) => current.includes("[✓] Windows"))
  setup.mockInput.pressTab()
  setup.mockInput.pressEnter()
  const done = await frame(setup, (current) => current.includes("Submitted"))
  expect(done).toContain("35 (0–100)")
  expect(setup.responses).toEqual([
    {
      value: { name: "", rollout: 35, notify: false, channel: "beta", platforms: ["mac", "linux", "windows"] },
    },
  ])
})

test("confirm dismisses with the exit shortcut and renders read-only", async () => {
  using setup = await render("confirm")
  await frame(setup, (current) => current.includes("Keep it"))
  setup.mockInput.pressKey("c", { ctrl: true })
  const done = await frame(setup, (current) => current.includes("Dismissed"))
  expect(done).not.toContain("esc prompt")
  expect(setup.responses).toEqual([{ dismiss: true }])
})

test("a submitted widget shows its response summary", async () => {
  using setup = await render("form", { status: "submitted" })
  const done = await frame(setup, (current) => current.includes("Submitted"))
  expect(done).toContain("name: Spring update · rollout: 50")
})

test("a canvas shows its alt text and a shader its alt text", async () => {
  using chart = await render("chart")
  const drawn = await frame(chart, (current) => current.includes("Weekly signups"))
  expect(drawn).toContain("◈ Bar chart. Organic: W1 4.2k")
  expect(drawn).toContain("Tap a bar to choose it")
  using backdrop = await render("backdrop")
  const banner = await frame(backdrop, (current) => current.includes("v2 is live"))
  expect(banner).toContain("◈ Animated aurora backdrop")
  expect(banner).toContain("Speed")
})

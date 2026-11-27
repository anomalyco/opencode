import { program } from "@opencode/widget"
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
  options: {
    width?: number
    status?: WidgetInfo["status"]
    program?: WidgetBackend["program"]
    widget?: Partial<WidgetInfo>
  } = {},
) {
  const responses: WidgetResponse[] = []
  const reports: Parameters<WidgetBackend["report"]>[0]["error"][] = []
  const asks: Parameters<WidgetBackend["report"]>[0]["error"][] = []
  const [message, setMessage] = createSignal({ ...widgetFixtureMessage(name, options.status), ...options.widget })
  const backend: WidgetBackend = {
    program:
      options.program ??
      ((widgetTemplate) => cached(widgetTemplate, () => Promise.reject(new Error("not a built-in")))),
    async respond(input) {
      responses.push(input.response)
      setMessage((current) => ({
        ...current,
        status: "dismiss" in input.response ? "dismissed" : "submitted",
        ...("value" in input.response ? { response: input.response.value } : {}),
      }))
    },
    async send() {},
    async report(input) {
      if (input.ask) {
        asks.push(input.error)
        setMessage((current) =>
          current.failure ? { ...current, failure: { ...current.failure, sent: true } } : current,
        )
        return
      }
      reports.push(input.error)
    },
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
  return { ...setup, responses, reports, asks, message, [Symbol.dispose]: () => setup.renderer.destroy() }
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

test("a superseded widget is one line pointing to its replacement", async () => {
  using setup = await render("confirm", { status: "superseded" })
  const current = await frame(setup, (current) => current.includes("Updated below"))
  expect(current).not.toContain("Confirm")
})

test("a failure the agent wasn't told about offers to ask it, once", async () => {
  using setup = await render("confirm", {
    widget: {
      failure: { phase: "view", message: "data.items is undefined", line: 3, column: 7, client: "rune", sent: false },
    },
  })
  const shown = await frame(setup, (current) => current.includes("Ask agent to fix it"))
  expect(shown).toContain("Failed on rune: view: data.items is undefined (line 3, col 7)")
  const lines = shown.split("\n")
  const y = lines.findIndex((line) => line.includes("Ask agent to fix it"))
  await setup.mockMouse.click(lines[y]!.indexOf("Ask agent"), y)
  await frame(setup, (current) => current.includes("The agent was told about this error."))
  expect(setup.asks).toEqual([{ phase: "view", message: "data.items is undefined", line: 3, column: 7 }])
  expect(setup.reports).toEqual([])
})

test("a live widget points to desktop and mobile instead of running", async () => {
  using setup = await render("confirm", { program: async () => ({ program: "", mode: "live" }) })
  const current = await frame(setup, (current) => current.includes("Open this widget on desktop or mobile."))
  expect(current).not.toContain("Confirm")
})

test("a failing step is reported to the agent", async () => {
  const source = 'function view() {\n  return ui.button("Go", { onPress: () => { throw new Error("boom") } })\n}'
  using setup = await render("confirm", { program: async () => ({ program: program(source), mode: "step" }) })
  await frame(setup, (current) => current.includes("Go"))
  setup.mockInput.pressTab()
  setup.mockInput.pressEnter()
  await frame(setup, (current) => current.includes("boom"))
  expect(setup.reports).toEqual([{ phase: "event", message: "Error: boom" }])
})

test("a widget template that fails to load is reported, with no position past the widget template's source", async () => {
  const source = 'function view() {\n  return ui.text("x")\n}\nfunction helper( {\n}'
  using setup = await render("confirm", { program: async () => ({ program: program(source), mode: "step" }) })
  await frame(setup, (current) => current.includes("Widget failed to load"))
  expect(setup.reports).toEqual([
    {
      phase: "init",
      message: "SyntaxError: Unexpected token. Code must be plain JavaScript written as a program body.",
    },
  ])
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

test("a stack shows its layers top to bottom in order, since the terminal can't layer", async () => {
  const source = `function view() {
  return ui.stack([
    ui.canvas({ height: 200, place: "fill", alt: "Tunnel game" }),
    ui.text("Score 3", { place: "top-left", inset: 8 }),
    ui.button("Pause", { place: "bottom-right", inset: 12, onPress: (state) => state }),
  ])
}`
  using setup = await render("confirm", { program: async () => ({ program: program(source), mode: "step" }) })
  const shown = await frame(setup, (current) => current.includes("Pause"))
  const at = (text: string) => shown.split("\n").findIndex((line) => line.includes(text))
  expect(at("◈ Tunnel game")).toBeGreaterThan(-1)
  expect(at("◈ Tunnel game")).toBeLessThan(at("Score 3"))
  expect(at("Score 3")).toBeLessThan(at("Pause"))
})

test("2D and GPU canvases show their alt text", async () => {
  using chart = await render("chart")
  const drawn = await frame(chart, (current) => current.includes("Weekly signups"))
  expect(drawn).toContain("◈ Bar chart. Organic: W1 4.2k")
  expect(drawn).toContain("Tap a bar to choose it")
  using backdrop = await render("backdrop")
  const banner = await frame(backdrop, (current) => current.includes("v2 is live"))
  expect(banner).toContain("◈ Animated aurora backdrop")
  expect(banner).toContain("Speed")
})

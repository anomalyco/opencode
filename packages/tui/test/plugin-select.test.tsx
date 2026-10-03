import { InputRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { Dialog } from "@opencode/plugin/tui/context"
import { createSignal } from "solid-js"
import { ConfigProvider } from "../src/config"
import { Keymap } from "../src/context/keymap"
import { ThemeProvider } from "../src/context/theme"
import { createDialogApi } from "../src/plugin/api"
import { DialogProvider, useDialog } from "../src/ui/dialog"
import { ToastProvider } from "../src/ui/toast"
import { emptyThemeSource, tmpdir } from "./fixture/fixture"
import { TestTuiContexts } from "./fixture/tui-environment"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"

async function mount(root: string) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  const dialog = Promise.withResolvers<Dialog>()

  function Fixture() {
    dialog.resolve(createDialogApi(useDialog(), (render) => render()))
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>
                  <Fixture />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  )
  app.renderer.start()
  return { app, dialog: await dialog.promise }
}

async function opened(app: Awaited<ReturnType<typeof mount>>["app"], title: string) {
  await app.waitForFrame((frame) => frame.includes(title))
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
}

function rows(frame: string, titles: string[]) {
  return titles.toSorted((left, right) => frame.indexOf(left) - frame.indexOf(right))
}

test("search orders enabled options across categories and receives every query", async () => {
  await using tmp = await tmpdir()
  const select = await mount(tmp.path)
  const calls: [string, string[]][] = []
  try {
    const chosen = select.dialog.select({
      title: "Projects",
      options: [
        { title: "Alpha", value: "alpha", category: "Recent" },
        { title: "Beta", value: "beta", category: "Pinned" },
        { title: "Gamma", value: "gamma", category: "Recent" },
        { title: "Delta", value: "delta", category: "Pinned", disabled: true },
      ],
      search: (query, options) => {
        calls.push([query, options.map((option) => option.value)])
        return options
          .filter((option) => option.title.toLowerCase().includes(query))
          .toSorted((left, right) => right.title.localeCompare(left.title))
      },
    })
    await opened(select.app, "Projects")
    const frame = select.app.captureCharFrame()
    expect(rows(frame, ["Alpha", "Beta", "Gamma"])).toEqual(["Gamma", "Beta", "Alpha"])
    expect(frame).not.toContain("Delta")
    expect(frame).toMatch(/Gamma +Recent/)
    expect(frame).toMatch(/Beta +Pinned/)

    await select.app.mockInput.typeText("l")
    await select.app.waitForFrame((frame) => !frame.includes("Gamma"))
    expect(select.app.captureCharFrame()).not.toContain("Delta")
    select.app.mockInput.pressEnter()

    expect(await chosen).toBe("alpha")
    expect(calls[0]).toEqual(["", ["alpha", "beta", "gamma"]])
    expect(calls.at(-1)).toEqual(["l", ["alpha", "beta", "gamma"]])
  } finally {
    select.app.renderer.destroy()
  }
})

test("search keeps the selected value when its results reorder", async () => {
  await using tmp = await tmpdir()
  const select = await mount(tmp.path)
  const [reversed, setReversed] = createSignal(false)
  try {
    const chosen = select.dialog.select({
      title: "Ranked",
      options: ["First", "Second", "Third", "Fourth"].map((title) => ({ title, value: title.toLowerCase() })),
      search: (_, options) => (reversed() ? options.toReversed() : options),
    })
    await opened(select.app, "Ranked")
    select.app.mockInput.pressArrow("down")
    setReversed(true)
    await select.app.waitForFrame((frame) => frame.indexOf("Fourth") < frame.indexOf("First"))
    select.app.mockInput.pressEnter()

    expect(await chosen).toBe("second")
  } finally {
    select.app.renderer.destroy()
  }
})

test("search keeps a query's first result when the same query reorders", async () => {
  await using tmp = await tmpdir()
  const select = await mount(tmp.path)
  const [reversed, setReversed] = createSignal(false)
  try {
    const chosen = select.dialog.select({
      title: "Ranked",
      options: ["First", "Second", "Third", "Fourth"].map((title) => ({ title, value: title.toLowerCase() })),
      search: (query, options) => {
        const matches = options.filter((option) => option.value.includes(query))
        return reversed() ? matches.toReversed() : matches
      },
    })
    await opened(select.app, "Ranked")
    await select.app.mockInput.typeText("r")
    await select.app.waitForFrame((frame) => !frame.includes("Second"))
    setReversed(true)
    await select.app.waitForFrame((frame) => frame.indexOf("Fourth") < frame.indexOf("First"))
    select.app.mockInput.pressEnter()

    expect(await chosen).toBe("first")
  } finally {
    select.app.renderer.destroy()
  }
})

test("search scrolls a moved or replaced selection into view", async () => {
  await using tmp = await tmpdir()
  const select = await mount(tmp.path)
  const items = Array.from({ length: 30 }, (_, index) => {
    const title = `Item ${String(index).padStart(2, "0")}`
    return { title, value: title }
  })
  const [results, setResults] = createSignal(items)
  try {
    const chosen = select.dialog.select({
      title: "Long",
      options: items,
      search: () => results(),
    })
    await opened(select.app, "Long")
    expect(select.app.captureCharFrame()).not.toContain("Item 29")

    setResults(items.toReversed())
    await select.app.waitForFrame((frame) => frame.includes("Item 00") && !frame.includes("Item 29"))
    setResults(items.slice(1).toReversed())
    await select.app.waitForFrame((frame) => frame.includes("Item 01") && !frame.includes("Item 00"))
    select.app.mockInput.pressEnter()

    expect(await chosen).toBe("Item 01")
  } finally {
    select.app.renderer.destroy()
  }
})

test("search ignores disabled records returned by the callback", async () => {
  await using tmp = await tmpdir()
  const select = await mount(tmp.path)
  const hidden = { title: "Hidden", value: "hidden", disabled: true }
  const triggered: string[] = []
  try {
    const chosen = select.dialog.select({
      title: "Guarded",
      options: [{ title: "Alpha", value: "alpha" }],
      search: (_, options) => [hidden, ...options],
      shortcuts: [{ key: "ctrl+o", title: "Inspect", onTrigger: (value) => triggered.push(value) }],
    })
    await opened(select.app, "Guarded")
    expect(select.app.captureCharFrame()).not.toContain("Hidden")
    select.app.mockInput.pressKey("o", { ctrl: true })
    select.app.mockInput.pressEnter()

    expect(await chosen).toBe("alpha")
    expect(triggered).toEqual(["alpha"])
  } finally {
    select.app.renderer.destroy()
  }
})

test("search returns to the first row when the query clears without a current value", async () => {
  await using tmp = await tmpdir()
  const select = await mount(tmp.path)
  try {
    const chosen = select.dialog.select({
      title: "Cleared",
      options: ["Alpha", "Beta", "Gamma"].map((title) => ({ title, value: title.toLowerCase() })),
      search: (query, options) => options.filter((option) => option.value.includes(query)),
    })
    await opened(select.app, "Cleared")
    await select.app.mockInput.typeText("g")
    await select.app.waitForFrame((frame) => !frame.includes("Beta"))
    select.app.mockInput.pressBackspace()
    await select.app.waitForFrame((frame) => frame.includes("Beta"))
    select.app.mockInput.pressEnter()

    expect(await chosen).toBe("alpha")
  } finally {
    select.app.renderer.destroy()
  }
})

test("search selects the current value once it arrives in the results", async () => {
  await using tmp = await tmpdir()
  const select = await mount(tmp.path)
  const options = ["Alpha", "Beta", "Gamma"].map((title) => ({ title, value: title.toLowerCase() }))
  const [results, setResults] = createSignal<typeof options>([])
  try {
    const chosen = select.dialog.select({ title: "Loading", options, current: "gamma", search: () => results() })
    await opened(select.app, "Loading")
    setResults(options)
    await select.app.waitForFrame((frame) => frame.includes("Gamma"))
    select.app.mockInput.pressEnter()

    expect(await chosen).toBe("gamma")
  } finally {
    select.app.renderer.destroy()
  }
})

test("search returns to the current value when the query clears", async () => {
  await using tmp = await tmpdir()
  const select = await mount(tmp.path)
  try {
    const chosen = select.dialog.select({
      title: "Current",
      options: ["Alpha", "Beta", "Gamma"].map((title) => ({ title, value: title.toLowerCase() })),
      current: "beta",
      search: (query, options) => options.filter((option) => option.value.includes(query)),
    })
    await opened(select.app, "Current")
    await select.app.mockInput.typeText("g")
    await select.app.waitForFrame((frame) => !frame.includes("Beta"))
    select.app.mockInput.pressBackspace()
    await select.app.waitForFrame((frame) => frame.includes("Beta"))
    select.app.mockInput.pressEnter()

    expect(await chosen).toBe("beta")
  } finally {
    select.app.renderer.destroy()
  }
})

test.each([
  [false, true],
  [0, 1],
  ["", "other"],
])("shortcuts deliver the selected value %p from keyboard, footer click, and footer focus", async (value, other) => {
  await using tmp = await tmpdir()
  const select = await mount(tmp.path)
  const triggered: unknown[] = []
  let settled = false
  try {
    const chosen = select.dialog.select<typeof value | typeof other>({
      title: "Values",
      options: [
        { title: "Chosen", value },
        { title: "Other", value: other },
      ],
      shortcuts: [{ key: "ctrl+o", title: "Inspect", onTrigger: (selected) => triggered.push(selected) }],
    })
    void chosen.then(() => (settled = true))
    await opened(select.app, "Values")
    await select.app.waitForFrame((frame) => frame.includes("Inspect ctrl+o"))

    select.app.mockInput.pressKey("o", { ctrl: true })
    const frame = select.app.captureCharFrame().split("\n")
    const row = frame.findIndex((line) => line.includes("Inspect ctrl+o"))
    await select.app.mockMouse.click(frame[row]!.indexOf("Inspect") + 1, row)
    select.app.mockInput.pressTab()
    select.app.mockInput.pressEnter()
    await select.app.waitFor(() => triggered.length === 3)
    await Bun.sleep(10)

    expect(triggered).toEqual([value, value, value])
    expect(settled).toBe(false)
    expect(select.app.captureCharFrame()).toContain("Values")
  } finally {
    select.app.renderer.destroy()
  }
})

test("shortcuts receive object values and unbind when the dialog closes", async () => {
  await using tmp = await tmpdir()
  const select = await mount(tmp.path)
  const project = { id: "acme" }
  const triggered: { id: string }[] = []
  try {
    const chosen = select.dialog.select({
      title: "Objects",
      options: [{ title: "Acme", value: project }],
      shortcuts: [{ key: "ctrl+o", title: "Inspect", onTrigger: (selected) => triggered.push(selected) }],
    })
    await opened(select.app, "Objects")
    select.app.mockInput.pressKey("o", { ctrl: true })
    select.app.mockInput.pressEscape()

    expect(await chosen).toBeUndefined()
    await select.app.waitForFrame((frame) => !frame.includes("Objects"))
    select.app.mockInput.pressKey("o", { ctrl: true })
    expect(triggered).toEqual([project])
    expect(triggered[0]).toBe(project)
  } finally {
    select.app.renderer.destroy()
  }
})

test("only no-selection shortcuts run without results", async () => {
  await using tmp = await tmpdir()
  const select = await mount(tmp.path)
  const triggered: string[] = []
  try {
    void select.dialog.select({
      title: "Empty",
      options: [{ title: "Alpha", value: "alpha" }],
      search: () => [],
      shortcuts: [
        { key: "ctrl+o", title: "Inspect", onTrigger: (value) => triggered.push(value) },
        { key: "ctrl+a", title: "New", side: "right", selection: "none", onTrigger: () => triggered.push("new") },
      ],
    })
    await opened(select.app, "Empty")
    await select.app.waitForFrame((frame) => frame.includes("New ctrl+a"))
    select.app.mockInput.pressKey("o", { ctrl: true })
    select.app.mockInput.pressKey("a", { ctrl: true })

    expect(triggered).toEqual(["new"])
  } finally {
    select.app.renderer.destroy()
  }
})

test("a shortcut that opens a replacement dialog settles the select and keeps the replacement", async () => {
  await using tmp = await tmpdir()
  const select = await mount(tmp.path)
  const triggered: string[] = []
  try {
    const chosen = select.dialog.select({
      title: "Projects",
      options: [{ title: "Alpha", value: "alpha" }],
      shortcuts: [
        {
          key: "ctrl+o",
          title: "Rename",
          onTrigger: (value) => {
            triggered.push(value)
            void select.dialog.prompt({ title: `Rename ${value}` })
          },
        },
      ],
    })
    await opened(select.app, "Projects")
    select.app.mockInput.pressKey("o", { ctrl: true })

    expect(await chosen).toBeUndefined()
    await select.app.waitForFrame((frame) => frame.includes("Rename alpha"))
    select.app.mockInput.pressKey("o", { ctrl: true })
    await Bun.sleep(10)

    expect(triggered).toEqual(["alpha"])
    expect(select.app.captureCharFrame()).toContain("Rename alpha")
    expect(select.app.captureCharFrame()).not.toContain("Projects")
  } finally {
    select.app.renderer.destroy()
  }
})

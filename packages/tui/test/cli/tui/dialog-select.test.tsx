/** @jsxImportSource @opentui/solid */
import { InputRenderable, type RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createSignal, onCleanup, onMount } from "solid-js"
import { dialogWidth } from "../../../src/ui/dialog"
import { dialogSelectContentWidth, type DialogSelectOption } from "../../../src/ui/dialog-select"
import { truncateFilePath } from "../../../src/ui/file-path"
import { stringWidth } from "../../../src/util/string-width"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

async function renderSelect(
  root: string,
  options: DialogSelectOption<string>[],
  onGlobal: () => void,
  onRow: (option: DialogSelectOption<string>) => void,
  current?: string,
) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  const config = createTuiResolvedConfig()
  const [{ ConfigProvider }, { ThemeProvider }, { Keymap }, { DialogProvider }, { DialogSelect }, { ToastProvider }] =
    await Promise.all([
      import("../../../src/config"),
      import("../../../src/context/theme"),
      import("../../../src/context/keymap"),
      import("../../../src/ui/dialog"),
      import("../../../src/ui/dialog-select"),
      import("../../../src/ui/toast"),
    ])

  function Harness() {
    function Select() {
      onCleanup(Keymap.use().mode.push("modal"))
      return (
        <DialogSelect
          title="Items"
          options={options}
          current={current}
          actions={[
            {
              command: "dialog.move_session.delete",
              title: "delete",
              onTrigger: onRow,
            },
            {
              command: "dialog.move_session.new",
              title: "new",
              selection: "none",
              onTrigger: onGlobal,
            },
          ]}
        />
      )
    }

    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <ConfigProvider config={config}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>
                  <Select />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 20, kittyKeyboard: true })
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Items"))
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  return app
}

async function mountSelect(
  root: string,
  initial: DialogSelectOption<string>[],
  current?: string,
  focusCurrent?: boolean,
  select?: { flat?: boolean },
) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  const config = createTuiResolvedConfig()
  const [
    { ConfigProvider },
    { ThemeProvider },
    { Keymap },
    { DialogProvider, useDialog },
    { DialogSelect },
    { ToastProvider },
  ] = await Promise.all([
    import("../../../src/config"),
    import("../../../src/context/theme"),
    import("../../../src/context/keymap"),
    import("../../../src/ui/dialog"),
    import("../../../src/ui/dialog-select"),
    import("../../../src/ui/toast"),
  ])

  const selected: string[] = []
  const moved: string[] = []
  let replaceOptions!: (options: DialogSelectOption<string>[]) => void

  function Harness() {
    const [options, setOptions] = createSignal(initial)
    replaceOptions = setOptions

    function Fixture() {
      const dialog = useDialog()
      onMount(() =>
        dialog.replace(() => (
          <DialogSelect
            title="Mutable options"
            options={options()}
            current={current}
            focusCurrent={focusCurrent}
            flat={select?.flat}
            onMove={(option) => moved.push(option.value)}
            onSelect={(option) => selected.push(option.value)}
          />
        )),
      )
      return null
    }

    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <ConfigProvider config={config}>
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
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 24, kittyKeyboard: true })
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Mutable options"))
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  return { app, moved, replaceOptions, selected }
}

test("budgets option content for constrained and full-width large dialogs", () => {
  expect(dialogSelectContentWidth(Math.min(dialogWidth("large"), 62 - 2)) - 7).toBe(41)
  expect(dialogSelectContentWidth(Math.min(dialogWidth("large"), 100 - 2)) - 7).toBe(69)
})

test("renders the complete truncated footer within the option row", async () => {
  await using tmp = await tmpdir()
  const title = "Project"
  const footer = truncateFilePath(
    "/tmp/opencode/projects/a-very-long-project-directory/distinctive-tail.tsx",
    dialogSelectContentWidth(dialogWidth("medium")) - stringWidth(title),
  )
  const select = await mountSelect(tmp.path, [{ title, footer, value: "project" }])

  try {
    await select.app.waitForFrame((frame) => frame.includes(footer))
    expect(select.app.captureCharFrame()).toContain(footer)
  } finally {
    select.app.renderer.destroy()
  }
})

test("renders actions with a current selection", async () => {
  await using tmp = await tmpdir()
  const app = await renderSelect(
    tmp.path,
    [{ title: "Alpha", value: "alpha" }],
    () => {},
    () => {},
    "alpha",
  )

  try {
    await app.waitForFrame((frame) => frame.includes("delete"))
  } finally {
    app.renderer.destroy()
  }
})

test("passes the row foreground color to gutters", async () => {
  await using tmp = await tmpdir()
  const colors = new Map<string, RGBA>()
  const gutter = (item: string) => (color: RGBA) => {
    colors.set(item, color)
    return <text fg={color}>*</text>
  }
  const select = await mountSelect(tmp.path, [
    { title: "Alpha", value: "alpha", gutter: gutter("alpha") },
    { title: "Beta", value: "beta", gutter: gutter("beta") },
  ])

  try {
    await select.app.waitFor(() => colors.size === 2)
    const selected = colors.get("alpha")!.toInts()
    const idle = colors.get("beta")!.toInts()
    expect(selected).not.toEqual(idle)

    select.app.mockInput.pressArrow("down")
    await select.app.waitFor(() =>
      colors
        .get("alpha")!
        .toInts()
        .every((value, index) => value === idle[index]),
    )
    expect(colors.get("beta")!.toInts()).toEqual(selected)
  } finally {
    select.app.renderer.destroy()
  }
})

test("dialog actions run without options while row actions still require a selection", async () => {
  await using tmp = await tmpdir()
  let global = 0
  const rows: string[] = []
  const app = await renderSelect(
    tmp.path,
    [],
    () => global++,
    (option) => rows.push(option.value),
  )

  try {
    app.mockInput.pressKey("m", { ctrl: true })
    app.mockInput.pressKey("d", { ctrl: true })

    expect(global).toBe(1)
    expect(rows).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("renders one gap before an empty state", async () => {
  await using tmp = await tmpdir()
  const app = await renderSelect(
    tmp.path,
    [],
    () => {},
    () => {},
  )

  try {
    await app.waitForFrame((frame) => frame.includes("No items available"))
    const lines = app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.trim())
    expect(lines.indexOf("No items available") - lines.indexOf("Search")).toBe(2)
  } finally {
    app.renderer.destroy()
  }
})

test("footer actions run when filtering leaves no selected row", async () => {
  await using tmp = await tmpdir()
  let global = 0
  const rows: string[] = []
  const app = await renderSelect(
    tmp.path,
    [{ title: "Alpha", value: "alpha" }],
    () => global++,
    (option) => rows.push(option.value),
  )

  try {
    for (const key of "missing") app.mockInput.pressKey(key)
    await app.waitForFrame((frame) => frame.includes("No results found"))

    app.mockInput.pressKey("d", { ctrl: true })
    app.mockInput.pressTab()
    app.mockInput.pressEnter()

    expect(global).toBe(1)
    expect(rows).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("row actions receive the selected option", async () => {
  await using tmp = await tmpdir()
  const rows: string[] = []
  const app = await renderSelect(
    tmp.path,
    [{ title: "Alpha", value: "alpha" }],
    () => {},
    (option) => rows.push(option.value),
  )

  try {
    app.mockInput.pressKey("d", { ctrl: true })

    expect(rows).toEqual(["alpha"])
  } finally {
    app.renderer.destroy()
  }
})

test("selects the new final option immediately after removing the selected final option", async () => {
  await using tmp = await tmpdir()
  const options = ["first", "second", "third"].map((value) => ({ title: value, value }))
  const select = await mountSelect(tmp.path, options)

  try {
    select.app.mockInput.pressArrow("down")
    await select.app.waitFor(() => select.moved.at(-1) === "second")
    select.app.mockInput.pressArrow("down")
    await select.app.waitFor(() => select.moved.at(-1) === "third")
    select.replaceOptions(options.slice(0, -1))
    await select.app.waitForFrame((frame) => !frame.includes("third"))

    select.app.mockInput.pressEnter()
    await select.app.waitFor(() => select.selected.length === 1)

    expect(select.selected).toEqual(["second"])
  } finally {
    select.app.renderer.destroy()
  }
})

test("selects a repopulated option after removing the only option", async () => {
  await using tmp = await tmpdir()
  const select = await mountSelect(tmp.path, [{ title: "only", value: "only" }])

  try {
    select.replaceOptions([])
    await select.app.waitForFrame((frame) => frame.includes("No items available"))
    select.app.mockInput.pressEnter()
    expect(select.selected).toEqual([])

    select.replaceOptions([{ title: "replacement", value: "replacement" }])
    await select.app.waitForFrame((frame) => frame.includes("replacement"))
    select.app.mockInput.pressEnter()
    await select.app.waitFor(() => select.selected.length === 1)

    expect(select.selected).toEqual(["replacement"])
  } finally {
    select.app.renderer.destroy()
  }
})

test("keeps the cursor index while options are temporarily empty", async () => {
  await using tmp = await tmpdir()
  const options = ["first", "second", "third"].map((value) => ({ title: value, value }))
  const select = await mountSelect(tmp.path, options)

  try {
    select.app.mockInput.pressArrow("down")
    await select.app.waitFor(() => select.moved.at(-1) === "second")
    select.app.mockInput.pressArrow("down")
    await select.app.waitFor(() => select.moved.at(-1) === "third")
    select.replaceOptions([])
    await select.app.waitForFrame((frame) => frame.includes("No items available"))

    select.replaceOptions(options)
    await select.app.waitForFrame((frame) => frame.includes("third"))
    select.app.mockInput.pressEnter()
    await select.app.waitFor(() => select.selected.length === 1)

    expect(select.selected).toEqual(["third"])
  } finally {
    select.app.renderer.destroy()
  }
})

test("keeps the current option selected when options reorder", async () => {
  await using tmp = await tmpdir()
  const options = ["first", "current", "third"].map((value) => ({ title: value, value }))
  const select = await mountSelect(tmp.path, options, "current")

  try {
    select.replaceOptions([options[1], options[2], options[0]])
    await select.app.waitForFrame((frame) => frame.indexOf("current") < frame.indexOf("third"))
    select.app.mockInput.pressEnter()
    await select.app.waitFor(() => select.selected.length === 1)

    expect(select.selected).toEqual(["current"])
  } finally {
    select.app.renderer.destroy()
  }
})

test("shows no-match and still closes after a flat filter goes empty", async () => {
  await using tmp = await tmpdir()
  const select = await mountSelect(
    tmp.path,
    [
      { title: "models.dev", value: "models.dev", category: "Projects" },
      { title: "opencode2", value: "opencode2", category: "Projects" },
    ],
    undefined,
    undefined,
    { flat: true },
  )

  try {
    await select.app.waitForFrame((frame) => frame.includes("models.dev"))
    await select.app.mockInput.typeText("models")
    await select.app.waitForFrame((frame) => frame.includes("models.dev") && !frame.includes("opencode2"))
    await select.app.mockInput.typeText(" missing")
    await select.app.waitForFrame((frame) => frame.includes("No results found"))
    expect(select.app.captureCharFrame()).not.toContain("models.dev")

    select.app.mockInput.pressEscape()
    await select.app.waitForFrame((frame) => !frame.includes("Mutable options") && !frame.includes("No results found"))
  } finally {
    select.app.renderer.destroy()
  }
})

test("keeps the first row selected when current is only a marker", async () => {
  await using tmp = await tmpdir()
  const project = { title: "project", value: "project" }
  const select = await mountSelect(tmp.path, [project], "current", false)

  try {
    select.replaceOptions([
      { title: "recent session", value: "recent" },
      project,
      { title: "current session", value: "current" },
    ])
    await select.app.waitForFrame((frame) => frame.includes("recent session"))
    select.app.mockInput.pressEnter()
    await select.app.waitFor(() => select.selected.length === 1)

    expect(select.selected).toEqual(["recent"])
  } finally {
    select.app.renderer.destroy()
  }
})

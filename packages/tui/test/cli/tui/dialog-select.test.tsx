/** @jsxImportSource @opentui/solid */
import { InputRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createSignal, onCleanup, onMount } from "solid-js"
import type { DialogSelectOption } from "../../../src/ui/dialog-select"
import { tmpdir } from "../../fixture/fixture"
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
  const [
    { ConfigProvider },
    { ThemeProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
    { DialogProvider },
    { DialogSelect },
    { ToastProvider },
  ] = await Promise.all([
    import("../../../src/config"),
    import("../../../src/context/theme"),
    import("../../../src/keymap"),
    import("../../../src/ui/dialog"),
    import("../../../src/ui/dialog-select"),
    import("../../../src/ui/toast"),
  ])

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)

    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <ConfigProvider config={config}>
            <ThemeProvider mode="dark" source={{ discover: () => Promise.resolve({}) }}>
              <ToastProvider>
                <DialogProvider>
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
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </ConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 20, kittyKeyboard: true })
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Items"))
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  return app
}

async function mountSelect(root: string, initial: DialogSelectOption<string>[]) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  const config = createTuiResolvedConfig()
  const [
    { ConfigProvider },
    { ThemeProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
    { DialogProvider, useDialog },
    { DialogSelect },
    { ToastProvider },
  ] = await Promise.all([
    import("../../../src/config"),
    import("../../../src/context/theme"),
    import("../../../src/keymap"),
    import("../../../src/ui/dialog"),
    import("../../../src/ui/dialog-select"),
    import("../../../src/ui/toast"),
  ])

  const selected: string[] = []
  const moved: string[] = []
  let replaceOptions!: (options: DialogSelectOption<string>[]) => void

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const off = registerOpencodeKeymap(keymap, renderer, config)
    const [options, setOptions] = createSignal(initial)
    replaceOptions = setOptions
    onCleanup(off)

    function Fixture() {
      const dialog = useDialog()
      onMount(() =>
        dialog.replace(() => (
          <DialogSelect
            title="Mutable options"
            options={options()}
            onMove={(option) => moved.push(option.value)}
            onSelect={(option) => selected.push(option.value)}
          />
        )),
      )
      return null
    }

    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <ConfigProvider config={config}>
            <ThemeProvider mode="dark" source={{ discover: () => Promise.resolve({}) }}>
              <ToastProvider>
                <DialogProvider>
                  <Fixture />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </ConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 24, kittyKeyboard: true })
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Mutable options"))
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  return { app, moved, replaceOptions, selected }
}

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

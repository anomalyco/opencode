/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import type { InputRenderable, TextareaRenderable } from "@opentui/core"
import { TuiKeybind } from "../src/config/keybind"
import { getOpencodeModeStack, OPENCODE_BASE_MODE, OpencodeKeymapProvider, registerOpencodeKeymap } from "../src/keymap"
import type { LineDiscard } from "../src/util/line-discard"

function createResolvedKeymapConfig(input: TuiKeybind.KeybindOverrides = {}) {
  const keybinds = TuiKeybind.parse(input)
  return {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
}

test("legacy page key aliases compile as page keys", async () => {
  const sequences: Record<string, string[][]> = {}

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig({
      messages_page_up: "pgup",
      messages_page_down: "pgdown",
    })
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offLayer = keymap.registerLayer({
      bindings: config.keybinds.gather("session", ["session.page.up", "session.page.down"]),
    })
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["session.page.up", "session.page.down"],
    })
    sequences.up =
      bindings.get("session.page.up")?.map((binding) => binding.sequence.map((part) => part.stroke.name)) ?? []
    sequences.down =
      bindings.get("session.page.down")?.map((binding) => binding.sequence.map((part) => part.stroke.name)) ?? []
    onCleanup(() => {
      offLayer()
      offKeymap()
    })

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <box />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />)
  try {
    expect(sequences).toEqual({
      up: [["pageup"]],
      down: [["pagedown"]],
    })
  } finally {
    app.renderer.destroy()
  }
})

test("mode-less bindings stay active when opencode mode changes", async () => {
  const counts: Record<string, Record<string, number>> = {}

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig()
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offGlobal = keymap.registerLayer({
      commands: [
        { name: "session.list", run() {} },
        { name: "session.new", run() {} },
        { name: "session.page.up", run() {} },
        { name: "session.first", run() {} },
      ],
      bindings: config.keybinds.gather("test.global", [
        "session.list",
        "session.new",
        "session.page.up",
        "session.first",
      ]),
    })
    const offBase = keymap.registerLayer({
      mode: OPENCODE_BASE_MODE,
      commands: [{ name: "model.list", run() {} }],
      bindings: config.keybinds.gather("test.base", ["model.list"]),
    })
    const activeCounts = () =>
      Object.fromEntries(
        Array.from(
          keymap.getCommandBindings({
            visibility: "active",
            commands: ["session.list", "session.new", "session.page.up", "session.first", "model.list"],
          }),
          ([command, bindings]) => [command, bindings.length],
        ),
      )

    counts.base = activeCounts()
    const popQuestion = getOpencodeModeStack(keymap).push("question")
    counts.question = activeCounts()
    popQuestion()
    const popAutocomplete = getOpencodeModeStack(keymap).push("autocomplete")
    counts.autocomplete = activeCounts()
    popAutocomplete()

    onCleanup(() => {
      offBase()
      offGlobal()
      offKeymap()
    })

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <box />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />)
  try {
    expect(counts).toEqual({
      base: { "session.list": 1, "session.new": 1, "session.page.up": 2, "session.first": 2, "model.list": 1 },
      question: { "session.list": 1, "session.new": 1, "session.page.up": 2, "session.first": 2, "model.list": 0 },
      autocomplete: {
        "session.list": 1,
        "session.new": 1,
        "session.page.up": 2,
        "session.first": 2,
        "model.list": 0,
      },
    })
  } finally {
    app.renderer.destroy()
  }
})

test("ctrl+u follows input.line_discard in a textarea, on the caret's line only, and in an input", async () => {
  async function run(mode: LineDiscard | undefined, field: "textarea" | "input", text: string, caret: number) {
    let editor: TextareaRenderable | InputRenderable | undefined

    function Harness() {
      const renderer = useRenderer()
      const keymap = createDefaultOpenTuiKeymap(renderer)
      const offKeymap = registerOpencodeKeymap(keymap, renderer, {
        ...createResolvedKeymapConfig(),
        input: { line_discard: mode },
      })
      onCleanup(offKeymap)
      const ref = (el: TextareaRenderable) => (editor = el)

      return (
        <OpencodeKeymapProvider keymap={keymap}>
          {field === "textarea" ? (
            <textarea ref={ref} focused initialValue={text} />
          ) : (
            <input ref={ref} focused value={text} />
          )}
        </OpencodeKeymapProvider>
      )
    }

    const app = await testRender(() => <Harness />)
    try {
      if (!editor) throw new Error(`${field} did not mount`)
      editor.cursorOffset = caret
      app.renderer.stdin.emit("data", Buffer.from("\x15"))
      await Bun.sleep(50)
      const after = { text: editor.plainText, caret: editor.cursorOffset }
      editor.undo()
      return { ...after, undone: editor.plainText }
    } finally {
      app.renderer.destroy()
    }
  }

  expect(await run(undefined, "textarea", "hello world", 5)).toEqual({
    text: " world",
    caret: 0,
    undone: "hello world",
  })
  expect(await run("bash", "textarea", "hello world", 5)).toEqual({ text: " world", caret: 0, undone: "hello world" })
  expect(await run("zsh", "textarea", "hello world", 5)).toEqual({ text: "", caret: 0, undone: "hello world" })
  expect(await run("bash", "textarea", "first\nhello world\nlast", 11)).toEqual({
    text: "first\n world\nlast",
    caret: 6,
    undone: "first\nhello world\nlast",
  })
  expect(await run("zsh", "textarea", "first\nhello world\nlast", 11)).toEqual({
    text: "first\n\nlast",
    caret: 6,
    undone: "first\nhello world\nlast",
  })
  // A second press on the emptied line joins it to the previous one.
  expect(await run("zsh", "textarea", "first\n\nlast", 6)).toEqual({
    text: "first\nlast",
    caret: 5,
    undone: "first\n\nlast",
  })
  expect(await run("bash", "input", "hello world", 5)).toEqual({ text: " world", caret: 0, undone: "hello world" })
  expect(await run("zsh", "input", "hello world", 5)).toEqual({ text: "", caret: 0, undone: "hello world" })
})

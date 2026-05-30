/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import {
  DIALOG_LAYER_PRIORITY,
  getOpencodeModeStack,
  OPENCODE_BASE_MODE,
  OpencodeKeymapProvider,
  registerOpencodeKeymap,
} from "@/cli/cmd/tui/keymap"

test("legacy page key aliases compile as page keys", async () => {
  const sequences: Record<string, string[][]> = {}

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig({
      keybinds: {
        messages_page_up: "pgup",
        messages_page_down: "pgdown",
      },
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

test("dialog priority beats newer default priority bindings", async () => {
  const runs: string[] = []

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig()
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offDialog = keymap.registerLayer({
      priority: DIALOG_LAYER_PRIORITY,
      commands: [
        {
          name: "test.dialog",
          run() {
            runs.push("dialog")
          },
        },
      ],
      bindings: [{ key: "ctrl+g", cmd: "test.dialog" }],
    })
    const offGlobal = keymap.registerLayer({
      commands: [
        {
          name: "test.global",
          run() {
            runs.push("global")
          },
        },
      ],
      bindings: [{ key: "ctrl+g", cmd: "test.global" }],
    })

    onCleanup(() => {
      offGlobal()
      offDialog()
      offKeymap()
    })

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <box />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  try {
    app.mockInput.pressKey("g", { ctrl: true })
    expect(runs).toEqual(["dialog"])
  } finally {
    app.renderer.destroy()
  }
})

test("mode-less bindings stay active when opencode mode changes", async () => {
  const counts: Record<string, Record<string, number>> = {}

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig()
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
      base: {
        "session.list": 1,
        "session.new": 1,
        "session.page.up": 2,
        "session.first": 2,
        "model.list": 1,
      },
      question: {
        "session.list": 1,
        "session.new": 1,
        "session.page.up": 2,
        "session.first": 2,
        "model.list": 0,
      },
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

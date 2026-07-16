/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { type TextareaRenderable } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup, onMount } from "solid-js"
import { TuiKeybind } from "../src/config/keybind"
import {
  formatKeySequence,
  getOpencodeModeStack,
  OPENCODE_BASE_MODE,
  OpencodeKeymapProvider,
  registerOpencodeKeymap,
} from "../src/keymap"

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
      bindings: ["session.page.up", "session.page.down"].flatMap((command) => config.keybinds.get(command)),
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

test("formats navigation keys as arrows", async () => {
  const shortcuts: Record<string, string> = {}

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig()
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const commands = ["session.parent", "session.child.first", "session.child.previous", "session.child.next"]
    const offLayer = keymap.registerLayer({
      bindings: commands.flatMap((command) => config.keybinds.get(command)),
    })
    const bindings = keymap.getCommandBindings({ visibility: "registered", commands })
    commands.forEach((command) => {
      shortcuts[command] = formatKeySequence(bindings.get(command)?.[0]?.sequence, config)
    })
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
    expect(shortcuts).toEqual({
      "session.parent": "↑",
      "session.child.first": "↓",
      "session.child.previous": "←",
      "session.child.next": "→",
    })
  } finally {
    app.renderer.destroy()
  }
})

test("dispatches message navigation while the composer is focused", async () => {
  for (const kittyKeyboard of [false, true]) {
    const counts = {
      "session.first": 0,
      "session.message.previous": 0,
      "session.message.next": 0,
      "session.messages_last_user": 0,
    }

    function Harness() {
      const renderer = useRenderer()
      const keymap = createDefaultOpenTuiKeymap(renderer)
      const config = createResolvedKeymapConfig()
      const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
      const commands = Object.keys(counts) as (keyof typeof counts)[]
      const offLayer = keymap.registerLayer({
        commands: commands.map((name) => ({
          name,
          run() {
            counts[name]++
          },
        })),
        bindings: commands.flatMap((command) => config.keybinds.get(command)),
      })
      let textarea: TextareaRenderable
      onMount(() => textarea.focus())
      onCleanup(() => {
        offLayer()
        offKeymap()
      })

      return (
        <OpencodeKeymapProvider keymap={keymap}>
          <textarea ref={(value) => (textarea = value)} />
        </OpencodeKeymapProvider>
      )
    }

    const app = await testRender(() => <Harness />, { kittyKeyboard })
    try {
      await app.renderOnce()
      app.mockInput.pressArrow("up", { meta: true })
      app.mockInput.pressArrow("down", { meta: true })
      app.mockInput.pressKey("HOME", { meta: true })
      app.mockInput.pressKey("END", { meta: true })
      expect(counts).toEqual({
        "session.first": 1,
        "session.message.previous": 1,
        "session.message.next": 1,
        "session.messages_last_user": 1,
      })
    } finally {
      app.renderer.currentFocusedEditor?.blur()
      app.renderer.destroy()
    }
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
      bindings: ["session.list", "session.new", "session.page.up", "session.first"].flatMap((command) =>
        config.keybinds.get(command),
      ),
    })
    const offBase = keymap.registerLayer({
      mode: OPENCODE_BASE_MODE,
      commands: [{ name: "model.list", run() {} }],
      bindings: config.keybinds.get("model.list"),
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
      base: { "session.list": 1, "session.new": 1, "session.page.up": 2, "session.first": 3, "model.list": 1 },
      question: { "session.list": 1, "session.new": 1, "session.page.up": 2, "session.first": 3, "model.list": 0 },
      autocomplete: {
        "session.list": 1,
        "session.new": 1,
        "session.page.up": 2,
        "session.first": 3,
        "model.list": 0,
      },
    })
  } finally {
    app.renderer.destroy()
  }
})

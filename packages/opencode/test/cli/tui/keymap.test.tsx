/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { formatKeyBindings, formatKeySequence, OpencodeKeymapProvider, registerOpencodeKeymap } from "@/cli/cmd/tui/keymap"

async function renderKeymap<T>(
  fn: (
    keymap: ReturnType<typeof createDefaultOpenTuiKeymap>,
    config: ReturnType<typeof createTuiResolvedConfig>,
  ) => T,
  configOverrides?: Parameters<typeof createTuiResolvedConfig>[0],
): Promise<T> {
  let result!: T
  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig(configOverrides)
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    result = fn(keymap, config)
    onCleanup(() => offKeymap())
    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <box />
      </OpencodeKeymapProvider>
    )
  }
  const app = await testRender(() => <Harness />)
  try {
    return result
  } finally {
    app.renderer.destroy()
  }
}

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

test("sequential leader shortcut displays with 'then'", async () => {
  const result = await renderKeymap((keymap, config) => {
    const offLayer = keymap.registerLayer({
      bindings: config.keybinds.gather("session", ["session.child.first"]),
    })
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["session.child.first"],
    })
    const sequence = bindings.get("session.child.first")?.[0]?.sequence
    onCleanup(() => offLayer())
    return formatKeySequence(sequence, config)
  })
  expect(result).toBe("ctrl+x then down")
})

test("custom leader shortcut displays with 'then' using custom leader", async () => {
  const result = await renderKeymap(
    (keymap, config) => {
      const offLayer = keymap.registerLayer({
        bindings: config.keybinds.gather("session", ["session.child.first"]),
      })
      const bindings = keymap.getCommandBindings({
        visibility: "registered",
        commands: ["session.child.first"],
      })
      const sequence = bindings.get("session.child.first")?.[0]?.sequence
      onCleanup(() => offLayer())
      return formatKeySequence(sequence, config)
    },
    { keybinds: { leader: "ctrl+j" } },
  )
  expect(result).toBe("ctrl+j then down")
})

test("single-part chord shortcut stays unchanged", async () => {
  const result = await renderKeymap((keymap, config) => {
    const offLayer = keymap.registerLayer({
      bindings: config.keybinds.gather("command", ["command.palette.show"]),
    })
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["command.palette.show"],
    })
    const sequence = bindings.get("command.palette.show")?.[0]?.sequence
    onCleanup(() => offLayer())
    return formatKeySequence(sequence, config)
  })
  expect(result).toBe("ctrl+p")
})

test("alternative bindings remain comma-separated without 'then' between alternatives", async () => {
  const result = await renderKeymap((keymap, config) => {
    const offLayer = keymap.registerLayer({
      bindings: config.keybinds.gather("app", ["app.exit"]),
    })
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["app.exit"],
    })
    onCleanup(() => offLayer())
    return formatKeyBindings(bindings.get("app.exit") ?? [], config)
  })
  expect(result).toBe("ctrl+c, ctrl+d, ctrl+x then q")
})

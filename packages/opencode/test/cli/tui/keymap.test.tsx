/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { formatKeyBindings, formatKeySequence, OpencodeKeymapProvider, registerOpencodeKeymap } from "@/cli/cmd/tui/keymap"

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
  const results: Record<string, string> = {}

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig()
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offLayer = keymap.registerLayer({
      bindings: config.keybinds.gather("session", ["session.child.first"]),
    })
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["session.child.first"],
    })
    const sequence = bindings.get("session.child.first")?.[0]?.sequence
    results.defaultLeader = formatKeySequence(sequence, config)
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
    expect(results.defaultLeader).toBe("ctrl+x then down")
  } finally {
    app.renderer.destroy()
  }
})

test("custom leader shortcut displays with 'then' using custom leader", async () => {
  const results: Record<string, string> = {}

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig({
      keybinds: {
        leader: "ctrl+j",
      },
    })
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offLayer = keymap.registerLayer({
      bindings: config.keybinds.gather("session", ["session.child.first"]),
    })
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["session.child.first"],
    })
    const sequence = bindings.get("session.child.first")?.[0]?.sequence
    results.customLeader = formatKeySequence(sequence, config)
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
    expect(results.customLeader).toBe("ctrl+j then down")
  } finally {
    app.renderer.destroy()
  }
})

test("single-part chord shortcut stays unchanged", async () => {
  const results: Record<string, string> = {}

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig()
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offLayer = keymap.registerLayer({
      bindings: config.keybinds.gather("command", ["command.palette.show"]),
    })
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["command.palette.show"],
    })
    const sequence = bindings.get("command.palette.show")?.[0]?.sequence
    results.singlePart = formatKeySequence(sequence, config)
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
    expect(results.singlePart).toBe("ctrl+p")
  } finally {
    app.renderer.destroy()
  }
})

test("alternative bindings remain comma-separated without 'then' between alternatives", async () => {
  const results: Record<string, string | undefined> = {}

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig()
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offLayer = keymap.registerLayer({
      bindings: config.keybinds.gather("app", ["app.exit"]),
    })
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["app.exit"],
    })
    results.alternatives = formatKeyBindings(bindings.get("app.exit") ?? [], config)
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
    expect(results.alternatives).toBe("ctrl+c, ctrl+d, ctrl+x then q")
  } finally {
    app.renderer.destroy()
  }
})

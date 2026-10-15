/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { ConfigProvider } from "../src/config"
import { Keymap } from "../src/context/keymap"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"

test("legacy page key aliases compile as page keys", async () => {
  let read = () => ({ up: "", down: "" })

  function Harness() {
    const shortcuts = Keymap.useShortcuts()
    Keymap.createLayer(() => ({
      commands: [
        { id: "session.page.up", run() {} },
        { id: "session.page.down", run() {} },
      ],
    }))
    read = () => ({
      up: shortcuts.get("session.page.up") ?? "",
      down: shortcuts.get("session.page.down") ?? "",
    })
    return <box />
  }

  const app = await testRender(() => (
    <ConfigProvider
      config={createTuiResolvedConfig({
        keybinds: {
          "session.page.up": "pgup",
          "session.page.down": "pgdown",
        },
      })}
    >
      <Keymap.Provider>
        <Harness />
      </Keymap.Provider>
    </ConfigProvider>
  ))
  try {
    expect(read()).toEqual({ up: "pgup", down: "pgdn" })
  } finally {
    app.renderer.destroy()
  }
})

test("formats navigation keys as arrows", async () => {
  let read = () => ({}) as Record<string, string>
  const commands = ["session.parent", "session.child.first"]

  function Harness() {
    const shortcuts = Keymap.useShortcuts()
    Keymap.createLayer(() => ({
      commands: commands.map((id) => ({ id, run() {} })),
    }))
    read = () => Object.fromEntries(commands.map((id) => [id, shortcuts.get(id) ?? ""]))
    return <box />
  }

  const app = await testRender(() => (
    <ConfigProvider config={createTuiResolvedConfig()}>
      <Keymap.Provider>
        <Harness />
      </Keymap.Provider>
    </ConfigProvider>
  ))
  try {
    expect(read()).toEqual({
      "session.parent": "↑",
      "session.child.first": "↓",
    })
  } finally {
    app.renderer.destroy()
  }
})

test("returns every formatted command shortcut", async () => {
  let read = () => [] as readonly string[]

  function Harness() {
    const shortcuts = Keymap.useShortcuts()
    Keymap.createLayer(() => ({
      commands: [{ id: "demo.command", bind: "x,y", run() {} }],
    }))
    read = () => shortcuts.list("demo.command")
    return <box />
  }

  const app = await testRender(() => (
    <ConfigProvider config={createTuiResolvedConfig()}>
      <Keymap.Provider>
        <Harness />
      </Keymap.Provider>
    </ConfigProvider>
  ))
  try {
    expect(read()).toEqual(["x", "y"])
  } finally {
    app.renderer.destroy()
  }
})

test("global commands stay reachable when the mode changes", async () => {
  const calls: string[] = []
  let exercise = () => {}

  function Harness() {
    const keymap = Keymap.use()
    Keymap.createLayer(() => ({
      mode: "global",
      commands: [{ id: "session.list", run: () => void calls.push("global") }],
    }))
    Keymap.createLayer(() => ({
      commands: [{ id: "model.list", run: () => void calls.push("base") }],
    }))

    exercise = () => {
      keymap.dispatch("session.list")
      keymap.dispatch("model.list")
      const pop = keymap.mode.push("question")
      keymap.dispatch("session.list")
      keymap.dispatch("model.list")
      pop()
    }
    return <box />
  }

  const app = await testRender(() => (
    <ConfigProvider config={createTuiResolvedConfig()}>
      <Keymap.Provider>
        <Harness />
      </Keymap.Provider>
    </ConfigProvider>
  ))
  try {
    exercise()
    expect(calls).toEqual(["global", "base", "global"])
  } finally {
    app.renderer.destroy()
  }
})

test("keypad CSI-u sequences reach commands bound to their kp names", async () => {
  const calls: string[] = []

  function Harness() {
    Keymap.createLayer(() => ({
      commands: [
        { id: "session.last", run: () => void calls.push("session.last") },
        { id: "session.parent", run: () => void calls.push("session.parent") },
      ],
    }))
    return <box />
  }

  const app = await testRender(() => (
    <ConfigProvider config={createTuiResolvedConfig()}>
      <Keymap.Provider>
        <Harness />
      </Keymap.Provider>
    </ConfigProvider>
  ))
  try {
    // Windows Terminal reports NumPad End/Home as kitty CSI-u sequences
    // (57424 = KP_End, 57423 = KP_Home) even outside full kitty mode.
    await app.mockInput.pressKeys(["\u001b[57424u", "\u001b[57423u"])
    await app.renderOnce()
    expect(calls).toEqual(["session.last"])
  } finally {
    app.renderer.destroy()
  }
})

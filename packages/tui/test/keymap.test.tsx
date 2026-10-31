/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
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

test("cmd and command modifier aliases bind to super without swallowing plain c in textarea", async () => {
  const calls: string[] = []
  let shortcuts = () => ({ new: [] as readonly string[], list: "" })

  function Harness() {
    const view = Keymap.useShortcuts()
    Keymap.createLayer(() => ({
      commands: [
        { id: "session.new", run: () => void calls.push("new") },
        { id: "session.list", run: () => void calls.push("list") },
      ],
    }))
    shortcuts = () => ({
      new: view.list("session.new"),
      list: view.get("session.list") ?? "",
    })
    return <textarea focused={true} />
  }

  const app = await testRender(
    () => (
      <ConfigProvider
        config={createTuiResolvedConfig({
          keybinds: {
            "session.new": "cmd+n,cmd+t",
            "session.list": "command+l",
          },
        })}
      >
        <Keymap.Provider>
          <Harness />
        </Keymap.Provider>
      </ConfigProvider>
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  )
  try {
    await app.renderOnce()
    const editor = app.renderer.currentFocusedEditor
    if (!(editor instanceof TextareaRenderable)) throw new Error("expected focused textarea")

    app.mockInput.pressKey("c")
    expect(editor.plainText).toBe("c")

    await app.mockInput.typeText("at")
    expect(editor.plainText).toBe("cat")

    expect(shortcuts()).toEqual({
      new: ["super+n", "super+t"],
      list: "super+l",
    })

    app.mockInput.pressKey("n", { super: true })
    app.mockInput.pressKey("t", { super: true })
    app.mockInput.pressKey("l", { super: true })
    expect(calls).toEqual(["new", "new", "list"])
    expect(editor.plainText).toBe("cat")
  } finally {
    app.renderer.destroy()
  }
})

test("cmd modifier alias works as a leader trigger", async () => {
  const calls: string[] = []

  function Harness() {
    Keymap.createLayer(() => ({
      commands: [{ id: "session.compact", run: () => void calls.push("compact") }],
    }))
    return <textarea focused={true} />
  }

  const app = await testRender(
    () => (
      <ConfigProvider
        config={createTuiResolvedConfig({
          keybinds: {
            leader: "cmd+x",
            "session.compact": "<leader>c",
          },
        })}
      >
        <Keymap.Provider>
          <Harness />
        </Keymap.Provider>
      </ConfigProvider>
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  )
  try {
    await app.renderOnce()
    const editor = app.renderer.currentFocusedEditor
    if (!(editor instanceof TextareaRenderable)) throw new Error("expected focused textarea")

    app.mockInput.pressKey("c")
    expect(editor.plainText).toBe("c")

    app.mockInput.pressKey("x", { super: true })
    app.mockInput.pressKey("c")
    expect(calls).toEqual(["compact"])
    expect(editor.plainText).toBe("c")
  } finally {
    app.renderer.destroy()
  }
})

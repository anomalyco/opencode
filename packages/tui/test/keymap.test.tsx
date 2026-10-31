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

test("default input.newline bindings insert newlines across kitty and legacy linefeed encodings", async () => {
  let textarea!: TextareaRenderable
  let submitted = 0

  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig()}>
        <Keymap.Provider>
          <textarea
            focused={true}
            initialValue="a"
            onSubmit={() => {
              submitted++
            }}
            ref={(value: TextareaRenderable) => {
              textarea = value
            }}
          />
        </Keymap.Provider>
      </ConfigProvider>
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  )
  try {
    textarea.gotoLineEnd()
    app.mockInput.pressEnter({ shift: true })
    app.mockInput.pressEnter({ ctrl: true })
    app.mockInput.pressEnter({ meta: true })
    app.mockInput.pressKey("j", { ctrl: true })
    app.renderer.stdin.emit("data", Buffer.from("\n"))
    expect(textarea.plainText).toBe("a\n\n\n\n\n")
    expect(submitted).toBe(0)
  } finally {
    app.renderer.destroy()
  }
})

test("unbound ctrl+j and ctrl+return do not insert newlines and run rebound commands", async () => {
  let textarea!: TextareaRenderable
  let debug = 0
  let submitted = 0

  function Harness() {
    Keymap.createLayer(() => ({
      mode: "global",
      commands: [{ id: "app.debug", bind: false, run: () => void debug++ }],
    }))
    Keymap.createLayer(() => ({
      bindings: ["app.debug"],
    }))
    return (
      <textarea
        focused={true}
        initialValue="hello"
        onSubmit={() => {
          submitted++
        }}
        ref={(value: TextareaRenderable) => {
          textarea = value
        }}
      />
    )
  }

  const app = await testRender(
    () => (
      <ConfigProvider
        config={createTuiResolvedConfig({
          keybinds: {
            "input.newline": "shift+return",
            "app.debug": ["ctrl+j", "ctrl+return"],
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
    textarea.gotoLineEnd()
    app.mockInput.pressKey("j", { ctrl: true })
    expect(debug).toBe(1)
    expect(textarea.plainText).toBe("hello")

    app.mockInput.pressEnter({ ctrl: true })
    expect(debug).toBe(2)
    expect(textarea.plainText).toBe("hello")

    app.renderer.stdin.emit("data", Buffer.from("\n"))
    expect(debug).toBe(3)
    expect(textarea.plainText).toBe("hello")

    app.mockInput.pressEnter({ meta: true })
    expect(submitted).toBe(0)
    expect(textarea.plainText).toBe("hello")

    app.mockInput.pressEnter({ shift: true })
    expect(textarea.plainText).toBe("hello\n")
  } finally {
    app.renderer.destroy()
  }
})

test("unbinding ctrl+j alone stops legacy linefeed from inserting a newline while keeping ctrl+return", async () => {
  let textarea!: TextareaRenderable

  const app = await testRender(
    () => (
      <ConfigProvider
        config={createTuiResolvedConfig({
          keybinds: {
            "input.newline": "shift+return,ctrl+return",
          },
        })}
      >
        <Keymap.Provider>
          <textarea
            focused={true}
            initialValue="hello"
            ref={(value: TextareaRenderable) => {
              textarea = value
            }}
          />
        </Keymap.Provider>
      </ConfigProvider>
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  )
  try {
    textarea.gotoLineEnd()
    app.mockInput.pressKey("j", { ctrl: true })
    app.renderer.stdin.emit("data", Buffer.from("\n"))
    expect(textarea.plainText).toBe("hello")

    app.mockInput.pressEnter({ ctrl: true })
    expect(textarea.plainText).toBe("hello\n")
  } finally {
    app.renderer.destroy()
  }
})

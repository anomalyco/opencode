/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { ConfigProvider } from "../../../src/config"
import { Keymap } from "../../../src/context/keymap"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

// Guards keybind resolution for #49216: `ctrl+b` is bound to both
// `session.background` and `input.move.left` (`left,ctrl+b`), the latter
// registered by the managed textarea layer while the prompt is focused. The
// later session layer wins, so the collision itself is not the failure — the
// guarded prompt command silently dropping the key was.
test("ctrl+b dispatches session.background while a textarea is focused", async () => {
  const calls: string[] = []

  function Harness() {
    Keymap.createLayer(() => ({
      commands: [
        {
          id: "session.background",
          title: "Background blocking tools",
          run: () => void calls.push("background"),
        },
      ],
    }))
    Keymap.createLayer(() => ({ bindings: ["session.background"] }))
    return <textarea focused={true} initialValue="abc" />
  }

  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig()}>
        <Keymap.Provider>
          <Harness />
        </Keymap.Provider>
      </ConfigProvider>
    ),
    { width: 80, height: 10, kittyKeyboard: true },
  )
  try {
    await app.renderOnce()
    app.mockInput.pressKey("b", { ctrl: true })
    await app.renderOnce()
    expect(calls).toEqual(["background"])
  } finally {
    app.renderer.destroy()
  }
})

test("a duplicate command that defers with false falls through to the earlier layer", async () => {
  // #49216: the prompt's `session.background` command shadows the session route's
  // unconditional one. Returning false (not bare return) lets the chain continue.
  const calls: string[] = []
  const blocked = true

  function Harness() {
    Keymap.createLayer(() => ({
      commands: [{ id: "session.background", run: () => void calls.push("session") }],
    }))
    Keymap.createLayer(() => ({
      commands: [
        {
          id: "session.background",
          run: () => {
            if (blocked) return false
            void calls.push("prompt")
          },
        },
      ],
    }))
    Keymap.createLayer(() => ({ bindings: ["session.background"] }))
    return <textarea focused={true} initialValue="abc" />
  }

  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig()}>
        <Keymap.Provider>
          <Harness />
        </Keymap.Provider>
      </ConfigProvider>
    ),
    { width: 80, height: 10, kittyKeyboard: true },
  )
  try {
    await app.renderOnce()
    app.mockInput.pressKey("b", { ctrl: true })
    await app.renderOnce()
    expect(calls).toEqual(["session"])
  } finally {
    app.renderer.destroy()
  }
})

test("a disabled duplicate command does not block the earlier layer", async () => {
  const calls: string[] = []

  function Harness() {
    Keymap.createLayer(() => ({
      commands: [{ id: "session.background", run: () => void calls.push("session") }],
    }))
    Keymap.createLayer(() => ({
      commands: [{ id: "session.background", enabled: () => false, run: () => void calls.push("prompt") }],
    }))
    Keymap.createLayer(() => ({ bindings: ["session.background"] }))
    return <textarea focused={true} initialValue="abc" />
  }

  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig()}>
        <Keymap.Provider>
          <Harness />
        </Keymap.Provider>
      </ConfigProvider>
    ),
    { width: 80, height: 10, kittyKeyboard: true },
  )
  try {
    await app.renderOnce()
    app.mockInput.pressKey("b", { ctrl: true })
    await app.renderOnce()
    expect(calls).toEqual(["session"])
  } finally {
    app.renderer.destroy()
  }
})

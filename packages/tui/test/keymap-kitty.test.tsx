/** @jsxImportSource @opentui/solid */
import type { TextareaRenderable } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup, type JSX } from "solid-js"
import { ConfigProvider } from "../src/config"
import { Keymap } from "../src/context/keymap"
import { handleSelectionKey } from "../src/util/selection"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"

function renderKeymap(Content: () => JSX.Element) {
  return testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig({ keybinds: { leader: "ctrl+x" } })}>
        <Keymap.Provider>
          <Content />
        </Keymap.Provider>
      </ConfigProvider>
    ),
    { width: 30, height: 5, useKittyKeyboard: { events: true, allKeysAsEscapes: true, reportText: true } },
  )
}

test("Kitty Ctrl down preserves transcript selection for Ctrl+C instead of exiting", async () => {
  const writes: string[] = []
  let exits = 0
  const app = await renderKeymap(() => {
    const renderer = useRenderer()
    const keymap = Keymap.use()
    onCleanup(
      keymap.intercept(
        "key",
        ({ event }) =>
          handleSelectionKey(renderer, { show() {}, error() {} }, event, {
            read: async () => undefined,
            async write(text) {
              writes.push(text)
            },
          }),
        { priority: 1 },
      ),
    )
    Keymap.createLayer(() => ({
      mode: "global",
      commands: [{ id: "app.exit", run: () => void exits++ }],
    }))
    return <text>alpha beta gamma</text>
  })

  try {
    await app.renderOnce()
    await app.mockMouse.click(6, 0)
    await app.mockMouse.click(6, 0)
    expect(app.renderer.getSelection()?.getSelectedText()).toBe("beta")

    await app.mockInput.pressKeys(["\x1b[57442;5u"])
    expect(app.renderer.getSelection()?.getSelectedText()).toBe("beta")
    await app.mockInput.pressKeys(["\x1b[99;5u", "\x1b[99;5:3u", "\x1b[57442;1:3u"])
    expect(writes).toEqual(["beta"])
    expect(exits).toBe(0)
  } finally {
    app.renderer.destroy()
  }
})

test("Kitty modifier-only events preserve a pending shifted leader sequence", async () => {
  let calls = 0
  let leader = () => false
  const app = await renderKeymap(() => {
    leader = Keymap.useLeaderActive()
    Keymap.createLayer(() => ({
      commands: [{ bind: "<leader>shift+r", run: () => void calls++ }],
    }))
    return <box />
  })

  try {
    await app.mockInput.pressKeys(["\x1b[57442;5u", "\x1b[120;5u"])
    expect(leader()).toBeTrue()
    for (const code of [57453, 57454]) {
      await app.mockInput.pressKeys([`\x1b[${code}u`, `\x1b[${code};1:3u`])
      expect(leader()).toBeTrue()
    }
    await app.mockInput.pressKeys(["\x1b[120;5:3u", "\x1b[57442;1:3u", "\x1b[57441;2u"])
    expect(leader()).toBeTrue()
    await app.mockInput.pressKeys(["\x1b[114:82;2u", "\x1b[114:82;2:3u", "\x1b[57441;1:3u"])
    expect(calls).toBe(1)
    expect(leader()).toBeFalse()
  } finally {
    app.renderer.destroy()
  }
})

test("Kitty associated text preserves Caps Lock and Shift+Caps Lock casing in a textarea", async () => {
  let textarea!: TextareaRenderable
  const app = await renderKeymap(() => <textarea ref={textarea} focused={true} />)

  try {
    await app.renderOnce()
    await app.mockInput.pressKeys(["\x1b[97;65;65u", "\x1b[97;65:3u"])
    expect(textarea.plainText).toBe("A")
    await app.mockInput.pressKeys(["\x1b[57441;66u", "\x1b[97;66;97u", "\x1b[97;66:3u", "\x1b[57441;65:3u"])
    expect(textarea.plainText).toBe("Aa")
  } finally {
    app.renderer.destroy()
  }
})

test("Control state follows either Kitty Control key, ignores chord releases, and clears on blur", async () => {
  let keymap!: Keymap
  const app = await renderKeymap(() => {
    keymap = Keymap.use()
    return <box />
  })

  try {
    expect(keymap.control()).toBeFalse()
    for (const code of [57442, 57448]) {
      await app.mockInput.pressKeys([`\x1b[${code};5u`])
      expect(keymap.control()).toBeTrue()
      await app.mockInput.pressKeys(["\x1b[49;5u", "\x1b[49;5:3u"])
      expect(keymap.control()).toBeTrue()
      await app.mockInput.pressKeys([`\x1b[${code};1:3u`])
      expect(keymap.control()).toBeFalse()
      await app.mockInput.pressKeys([`\x1b[${code};5u`])
      expect(keymap.control()).toBeTrue()
      app.renderer.emit("blur")
      expect(keymap.control()).toBeFalse()
    }
  } finally {
    app.renderer.destroy()
  }
})

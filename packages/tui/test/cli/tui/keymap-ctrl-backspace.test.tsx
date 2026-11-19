/** @jsxImportSource @opentui/solid */
import type { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { ConfigProvider } from "../../../src/config"
import { Keymap } from "../../../src/context/keymap"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

async function renderTextarea() {
  const refs: { input?: TextareaRenderable } = {}
  const app = await testRender(() => (
    <ConfigProvider config={createTuiResolvedConfig()}>
      <Keymap.Provider>
        <textarea
          focused
          initialValue="alpha beta"
          ref={(input: TextareaRenderable) => {
            refs.input = input
          }}
        />
      </Keymap.Provider>
    </ConfigProvider>
  ))
  await app.renderOnce()
  refs.input!.gotoBufferEnd()
  return { app, input: refs.input! }
}

async function withEnvironment(values: Record<string, string>, run: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  Object.assign(process.env, values)
  try {
    await run()
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  }
}

// WT_SESSION makes ^H count as Ctrl+Backspace on Windows too; elsewhere the test terminal's erase character decides.
test("a legacy Ctrl+Backspace (^H) deletes the previous word in a text area", () =>
  withEnvironment({ WT_SESSION: "test" }, async () => {
    const setup = await renderTextarea()
    try {
      setup.app.mockInput.pressKey("\b")
      expect(setup.input.plainText).toBe("alpha ")

      setup.app.mockInput.pressKey("\x7f")
      expect(setup.input.plainText).toBe("alpha")
    } finally {
      setup.app.renderer.destroy()
    }
  }))

test("^H stays a backspace inside herdr, where plain Backspace sends it", () =>
  withEnvironment({ HERDR_ENV: "1" }, async () => {
    const setup = await renderTextarea()
    try {
      setup.app.mockInput.pressKey("\b")
      expect(setup.input.plainText).toBe("alpha bet")
    } finally {
      setup.app.renderer.destroy()
    }
  }))

test("^H still runs a backspace binding where Ctrl+Backspace is unbound", async () => {
  const pressed: string[] = []
  function Layer() {
    Keymap.createLayer(() => ({
      mode: "global",
      commands: [{ bind: "backspace", title: "Back", run: () => void pressed.push("backspace") }],
    }))
    return <box />
  }
  const app = await testRender(() => (
    <ConfigProvider config={createTuiResolvedConfig()}>
      <Keymap.Provider>
        <Layer />
      </Keymap.Provider>
    </ConfigProvider>
  ))
  try {
    app.mockInput.pressKey("\b")
    app.mockInput.pressKey("\x7f")
    expect(pressed).toEqual(["backspace", "backspace"])
  } finally {
    app.renderer.destroy()
  }
})

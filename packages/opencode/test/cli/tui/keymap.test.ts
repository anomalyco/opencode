import { describe, expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { registerOpencodeKeymap } from "../../../src/cli/cmd/tui/keymap"
import { TuiKeybind } from "../../../src/cli/cmd/tui/config/keybind"
import type { TuiConfig } from "../../../src/cli/cmd/tui/config/tui"

function config(input: TuiKeybind.KeybindOverrides = {}): Pick<TuiConfig.Resolved, "keybinds" | "leader_timeout"> {
  return {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.Keybinds.parse(input)), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 1500,
  }
}

async function createTextarea(input: TuiKeybind.KeybindOverrides = {}, options?: { otherModifiersMode?: boolean }) {
  const setup = await createTestRenderer({ width: 40, height: 10, otherModifiersMode: options?.otherModifiersMode })
  const keymap = createDefaultOpenTuiKeymap(setup.renderer)
  const offKeymap = registerOpencodeKeymap(keymap, setup.renderer, config(input))
  const textarea = new TextareaRenderable(setup.renderer, {
    width: 20,
    height: 4,
    initialValue: "",
  })
  setup.renderer.root.add(textarea)
  textarea.focus()

  return {
    ...setup,
    textarea,
    dispose() {
      offKeymap()
      setup.renderer.destroy()
    },
  }
}

function waitForEscape() {
  return new Promise((resolve) => setTimeout(resolve, 30))
}

describe("opencode TUI keymap", () => {
  test("keeps OpenTUI linefeed newline fallback while textarea mappings are suspended", async () => {
    const setup = await createTextarea()
    try {
      expect(setup.textarea.traits.suspend).toBe(true)

      setup.textarea.setText("a")
      setup.textarea.cursorOffset = 1
      setup.mockInput.pressKey("LINEFEED")
      expect(setup.textarea.plainText).toBe("a\n")

      setup.textarea.setText("b")
      setup.textarea.cursorOffset = 1
      setup.mockInput.pressKey("j", { ctrl: true })
      expect(setup.textarea.plainText).toBe("b\n")
    } finally {
      setup.dispose()
    }
  })

  test("supports enter alias in configured textarea bindings", async () => {
    const setup = await createTextarea({ input_newline: "shift+enter" }, { otherModifiersMode: true })
    try {
      setup.textarea.setText("a")
      setup.textarea.cursorOffset = 1
      setup.mockInput.pressEnter({ shift: true })
      expect(setup.textarea.plainText).toBe("a\n")
    } finally {
      setup.dispose()
    }
  })

  test("supports esc alias in configured textarea bindings", async () => {
    const setup = await createTextarea({ input_delete: "esc,delete" })
    try {
      setup.textarea.setText("a")
      setup.textarea.cursorOffset = 0
      setup.mockInput.pressEscape()
      await waitForEscape()
      expect(setup.textarea.plainText).toBe("")
    } finally {
      setup.dispose()
    }
  })

  test("supports esc alias in non-textarea bindings", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    const keymap = createDefaultOpenTuiKeymap(setup.renderer)
    const offKeymap = registerOpencodeKeymap(keymap, setup.renderer, config())
    let interrupted = 0
    const offInterrupt = keymap.registerLayer({
      commands: [
        {
          name: "session.interrupt",
          run() {
            interrupted += 1
          },
        },
      ],
      bindings: [{ key: "esc,ctrl+x", cmd: "session.interrupt" }],
    })

    try {
      setup.mockInput.pressEscape()
      await waitForEscape()
      expect(interrupted).toBe(1)
    } finally {
      offInterrupt()
      offKeymap()
      setup.renderer.destroy()
    }
  })
})

import { createTestRenderer } from "@opentui/core/testing"
import { createBindingLookup } from "@opentui/keymap/extras"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { expect, test } from "bun:test"
import { TuiKeybind } from "../src/config/keybind"
import { OPENCODE_BASE_MODE, registerOpencodeKeymap } from "../src/keymap"

// Mirrors the intercept in app.tsx that dismisses a retained copy-on-select highlight.
test("a retained selection survives the leader sequence but not an unbound key", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const keymap = createDefaultOpenTuiKeymap(setup.renderer)
  const config = {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.parse({})), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
  const offKeymap = registerOpencodeKeymap(keymap, setup.renderer, config)

  const ran: string[] = []
  const offLayer = keymap.registerLayer({
    mode: OPENCODE_BASE_MODE,
    commands: [
      {
        name: "prompt.add_selection",
        run: () => {
          ran.push("add_selection")
        },
      },
    ],
    bindings: config.keybinds.gather("prompt.palette", ["prompt.add_selection"]),
  })

  let dialogOpen = false
  const dismissed: string[] = []
  const offIntercept = keymap.intercept(
    "key:after",
    (ctx) => {
      if (ctx.handled || ctx.pendingSequence.length > 0) return
      if (dialogOpen) return
      dismissed.push(ctx.event.name ?? "?")
    },
    { priority: 1 },
  )

  try {
    setup.mockInput.pressKey("x", { ctrl: true })
    expect(dismissed).toEqual([])

    setup.mockInput.pressKey("p")
    expect(ran).toEqual(["add_selection"])
    expect(dismissed).toEqual([])

    setup.mockInput.pressKey("a")
    expect(dismissed).toEqual(["a"])

    // Filtering the command palette must not drop the selection the command is about to read.
    dialogOpen = true
    setup.mockInput.pressKey("d")
    setup.mockInput.pressKey("d")
    expect(dismissed).toEqual(["a"])
  } finally {
    offIntercept()
    offLayer()
    offKeymap()
    setup.renderer.destroy()
  }
})

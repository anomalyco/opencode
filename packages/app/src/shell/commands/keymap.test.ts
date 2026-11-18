import { afterEach, expect, test } from "bun:test"
import type { CommandOption } from "./command"
import { createAppKeymap, registerCommandLayers } from "./keymap"

const cleanup: (() => void)[] = []

afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose())
  document.body.replaceChildren()
})

function setup(options: CommandOption[], input?: { custom?: string[]; blocked?: () => boolean }) {
  const app = createAppKeymap({
    blocked: input?.blocked ?? (() => false),
    editable: (target) => target instanceof HTMLElement && target.isContentEditable,
  })

  const layers = registerCommandLayers(app.keymap, options, (id) => input?.custom?.includes(id) ?? false)

  cleanup.push(() => {
    layers()
    app.destroy()
  })

  return app
}

function press(target: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)

  return event
}

function editor() {
  const element = document.createElement("div")
  element.contentEditable = "true"
  document.body.append(element)
  element.focus()

  return element
}

function command(id: string, keybind: string, ran: string[], extra?: Partial<CommandOption>): CommandOption {
  return { id, title: id, keybind, onSelect: () => void ran.push(id), ...extra }
}

// happy-dom never reports a Mac platform, so mod is Ctrl here.
test("a command with a when wins only in its context, then a user's binding, then the first registered", () => {
  const ran: string[] = []
  const inside = { value: true }
  setup(
    [
      command("tab.close", "mod+w", ran),
      command("file.close", "mod+w", ran),
      command("terminal.close", "mod+w", ran, { when: () => inside.value }),
    ],
    { custom: ["file.close"] },
  )

  press(document.body, { key: "w", ctrlKey: true })
  inside.value = false
  press(document.body, { key: "w", ctrlKey: true })

  expect(ran).toEqual(["terminal.close", "file.close"])
})

test("a declining command passes the key to the next command, and finally to the focused element", () => {
  const ran: string[] = []
  const skip = { value: true }
  setup([
    command("session.rename", "ctrl+r", ran, { skip: () => skip.value }),
    command("plugin.run", "ctrl+r", ran, { onSelect: () => (ran.push("plugin.run"), false) }),
  ])

  const declined = press(document.body, { key: "r", ctrlKey: true })
  skip.value = false
  const handled = press(document.body, { key: "r", ctrlKey: true })

  expect(ran).toEqual(["plugin.run", "session.rename"])
  expect(declined.defaultPrevented).toBe(false)
  expect(handled.defaultPrevented).toBe(true)
})

test("a key that types a character fires in a text field only for an editable command", () => {
  const ran: string[] = []
  setup([
    command("review.next", "j", ran),
    command("prompt.stop", "escape", ran, { editable: true }),
    command("model.choose", "mod+'", ran),
  ])
  const field = editor()

  const typed = press(field, { key: "j" })
  press(field, { key: "Escape" })
  press(field, { key: "'", ctrlKey: true })
  field.blur()
  press(document.body, { key: "j" })

  expect(typed.defaultPrevented).toBe(false)
  expect(ran).toEqual(["prompt.stop", "model.choose", "review.next"])
})

test("a focus target's command wins inside the target and is absent outside it", () => {
  const ran: string[] = []
  const field = editor()
  const outside = document.createElement("button")
  document.body.append(outside)
  setup([
    command("dialog.close", "escape", ran, { editable: true }),
    command("prompt.stop", "escape", ran, { editable: true, target: () => field }),
  ])

  press(field, { key: "Escape" })
  outside.focus()
  press(outside, { key: "Escape" })

  expect(ran).toEqual(["prompt.stop", "dialog.close"])
})

test.each([
  { name: "composing", init: { key: "Escape", isComposing: true } },
  { name: "Safari's composition Enter", init: { key: "Escape", keyCode: 229 } },
])("keys are left to the IME while it composes: $name", (row) => {
  const ran: string[] = []
  setup([command("prompt.stop", "escape", ran, { editable: true })])

  const event = press(editor(), row.init)

  expect(event.defaultPrevented).toBe(false)
  expect(ran).toEqual([])
})

test("keys are left alone while keybinds are blocked", () => {
  const ran: string[] = []
  const blocked = { value: true }
  setup([command("palette", "mod+k", ran)], { blocked: () => blocked.value })

  press(document.body, { key: "k", ctrlKey: true })
  blocked.value = false
  press(document.body, { key: "k", ctrlKey: true })

  expect(ran).toEqual(["palette"])
})

test.each([
  { keybind: "mod+alt+.", init: { key: "≥", code: "Period", ctrlKey: true, altKey: true } },
  { keybind: "mod+shift+[", init: { key: "{", code: "BracketLeft", ctrlKey: true, shiftKey: true } },
  { keybind: "alt+arrowup", init: { key: "ArrowUp", altKey: true } },
  { keybind: "mod+comma", init: { key: ",", ctrlKey: true } },
  { keybind: "shift+enter", init: { key: "Enter", shiftKey: true } },
])("$keybind matches the key the layout types", (row) => {
  const ran: string[] = []
  setup([command("run", row.keybind, ran)])

  press(document.body, row.init)

  expect(ran).toEqual(["run"])
})

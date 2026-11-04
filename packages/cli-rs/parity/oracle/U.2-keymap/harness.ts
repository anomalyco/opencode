// Runs key sequences through the TypeScript TUI's real Keymap.Provider and records the commands they run.
// U.2-keymap.ts runs this with OpenTUI's Solid preload from packages/tui. OpenTUI and Solid resolve as packages/tui
// resolves them, so that this file and the TUI sources share one Solid instance. Writes
// parity/fixtures/U.2/keymap.json.
import type { useKeymap } from "@opentui/keymap/solid"
import { resolve } from "../../../../tui/src/config"
import { TuiKeybind } from "../../../../tui/src/config/keybind"
import { Keymap } from "../../../../tui/src/context/keymap"

type Stroke = { name: string; ctrl: boolean; shift: boolean; meta: boolean; super: boolean; hyper: boolean }
type Step = string | number
type Case = { command?: string; keys: Step[]; commands: string[] }
type Scenario = {
  name: string
  keybinds: Record<string, unknown>
  terminalSuspend: boolean
  leaderTimeout?: number
  layout: "isolated" | "all"
  textarea: boolean
  // Names whose sequences the cases press; every name when absent.
  names?: string[]
  extra?: Step[][]
}

const tui = new URL("../../../../tui/", import.meta.url).pathname
const { TextareaRenderable } = await import(Bun.resolveSync("@opentui/core", tui))
const keymapSolid = await import(Bun.resolveSync("@opentui/keymap/solid", tui))
const { testRender } = await import(Bun.resolveSync("@opentui/solid", tui))
const { createComponent, createSignal } = await import(Bun.resolveSync("solid-js", tui))

const names = Object.keys(TuiKeybind.Definitions).filter((name) => name !== "leader")
const kitty = (stroke: Stroke) => encode(stroke, true)
const escape = "\x1b[27u"
const backspace = "\x1b[127u"

const leaderCases: Step[][] = [
  ["\x18", "n"],
  ["\x18", escape, "n"],
  ["\x18", backspace, "n"],
  ["\x18", backspace, "\x18", "n"],
  ["\x18", "z"],
  ["\x18", "z", "n"],
  ["g", "g"],
  ["g", "x"],
  ["g", escape, "g", "g"],
]

const scenarios: Scenario[] = [
  { name: "defaults isolated", keybinds: {}, terminalSuspend: true, layout: "isolated", textarea: false },
  {
    name: "defaults all",
    keybinds: {},
    terminalSuspend: true,
    layout: "all",
    textarea: false,
    extra: leaderCases,
  },
  {
    name: "defaults all with a focused textarea",
    keybinds: {},
    terminalSuspend: true,
    layout: "all",
    textarea: true,
    extra: [...leaderCases, ["\n"], ["\x1b[57414u"], ["a", "\x1b[13;3u"]],
  },
  ...[false, true].map((textarea) => ({
    name: `value forms${textarea ? " with a focused textarea" : ""}`,
    keybinds: {
      "session.new": "ctrl+n",
      "session.list": ["ctrl+k", "<leader>shift+l"],
      "model.list": { name: "m", ctrl: true, meta: true },
      "agent.list": { key: "alt+a", preventDefault: false },
      "agent.cycle": { key: { name: "tab", ctrl: true } },
      "session.compact": false,
      "session.export": "none",
      "session.timeline": [],
      "help.show": "f1",
      "docs.open": "ctrl+shift+h",
      "theme.switch": "enter",
      "theme.switch_mode": "esc",
      "diff.page.down": "pgdown",
      "diff.page.up": "PGUP",
      "mcp.list": "<leader>esc",
      "variant.list": "zz",
      "session.fork": { key: "ctrl+y", event: "release" },
      "usage.show": ["f5", { key: "f6", fallthrough: true }],
      "input.submit": "ctrl+s",
      "input.newline": "return",
    },
    terminalSuspend: true,
    layout: "all" as const,
    textarea,
    extra: [
      ["\x18", "\x1b[76;2u"],
      ["\x18", escape],
      ["z", "z"],
      ["\x18", "n"],
      ["\x18", "c"],
      ["\x18", "x"],
    ],
  })),
  {
    name: "custom leader",
    keybinds: { leader: "alt+x" },
    terminalSuspend: true,
    leaderTimeout: 50,
    layout: "all",
    textarea: false,
    names: ["session.new", "app.exit", "session.list", "session.tab.select.1", "prompt.queue"],
    extra: [
      ["\x1bx", "n"],
      ["\x1bx", 100, "n"],
      ["\x1bx", 10, "n"],
      ["\x18", "n"],
    ],
  },
  {
    name: "leader none",
    keybinds: { leader: "none" },
    terminalSuspend: true,
    layout: "all",
    textarea: false,
    names: ["session.new", "app.exit", "session.list"],
    extra: [
      ["\x18", "n"],
      ["\x18", "q"],
    ],
  },
  {
    name: "no terminal suspend",
    keybinds: {},
    terminalSuspend: false,
    layout: "all",
    textarea: true,
    names: ["terminal.suspend", "input.undo", "input.redo"],
    extra: [["\x1a"], ["\x1b[122;5u"]],
  },
  {
    name: "no terminal suspend with input.undo set",
    keybinds: { "input.undo": "ctrl+y", "terminal.suspend": "ctrl+t" },
    terminalSuspend: false,
    layout: "all",
    textarea: true,
    names: ["terminal.suspend", "input.undo"],
    extra: [["\x1a"], ["\x1b[122;5u"], ["\x1b[121;5u"]],
  },
]

const errors = [
  { nope: "x" },
  { "a.b": "x", "session.new": "ctrl+n", c: "y" },
  { "session.new": 3 },
  { "session.new": [false] },
  { "session.new": { ctrl: true } },
].map((keybinds) => ({ keybinds, error: errorOf(keybinds) }))

const results = []
for (const scenario of scenarios) results.push({ ...scenario, cases: await run(scenario) })

const file = new URL("../../fixtures/U.2/keymap.json", import.meta.url).pathname
await Bun.write(file, JSON.stringify({ scenarios: results, errors }, null, 1) + "\n")
console.log(
  `keymap: ${results.reduce((total, scenario) => total + scenario.cases.length, 0)} cases, ${errors.length} errors`,
)
process.exit(0)

async function run(scenario: Scenario): Promise<Case[]> {
  const config = resolve(
    { keybinds: scenario.keybinds as TuiKeybind.KeybindOverrides, leader: { timeout: scenario.leaderTimeout } },
    { terminalSuspend: scenario.terminalSuspend, environment: {} },
  )
  const calls: string[] = []
  const [registered, setRegistered] = createSignal<string[]>(scenario.layout === "all" ? names : [])
  let raw!: ReturnType<typeof useKeymap>
  function Harness() {
    raw = keymapSolid.useKeymap()
    Keymap.createLayer(() => ({
      commands: registered().map((id) => ({ id, run: () => void calls.push(id) })),
    }))
    return null
  }
  const app = await testRender(
    () =>
      createComponent(Keymap.Provider, {
        config,
        get children() {
          return createComponent(Harness, {})
        },
      }),
    { kittyKeyboard: true },
  )
  try {
    if (scenario.textarea) {
      const textarea = new TextareaRenderable(app.renderer, { id: "textarea" })
      app.renderer.root.add(textarea)
      textarea.focus()
    }
    // The sequences every configured binding has, from the "all" layer's registration.
    setRegistered(names)
    const bindings = raw.getCommandBindings({ visibility: "registered", commands: names })
    const pressed = scenario.names ?? names
    const sequences = pressed.flatMap((command) =>
      (bindings.get(command) ?? []).map((binding) => ({
        command,
        strokes: binding.sequence.map((part) => part.stroke as Stroke),
      })),
    )
    const cases: Case[] = []
    const press = async (keys: Step[], command?: string) => {
      raw.clearPendingSequence()
      calls.length = 0
      for (const key of keys) {
        if (typeof key === "number") await Bun.sleep(key)
        else app.renderer.stdin.emit("data", Buffer.from(key))
      }
      cases.push({ ...(command ? { command } : {}), keys, commands: [...calls] })
    }
    for (const sequence of sequences) {
      if (scenario.layout === "isolated") setRegistered([sequence.command])
      const encodings = [sequence.strokes.map(kitty), sequence.strokes.map((stroke) => encode(stroke, false))]
      const unique = encodings.filter(
        (keys, index) =>
          keys.every((key) => key !== undefined) &&
          encodings.findIndex((other) => JSON.stringify(other) === JSON.stringify(keys)) === index,
      ) as string[][]
      for (const keys of unique) await press(keys, scenario.layout === "isolated" ? sequence.command : undefined)
    }
    if (scenario.layout === "all") for (const keys of scenario.extra ?? []) await press(keys)
    return cases
  } finally {
    app.renderer.destroy()
  }
}

function errorOf(keybinds: Record<string, unknown>) {
  try {
    resolve({ keybinds: keybinds as TuiKeybind.KeybindOverrides }, { terminalSuspend: true, environment: {} })
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// Terminal bytes for a stroke: Kitty CSI-u, or the legacy encoding when one exists without loss.
function encode(stroke: Stroke, csi: boolean): string | undefined {
  const modifier =
    1 +
    (stroke.shift ? 1 : 0) +
    (stroke.meta ? 2 : 0) +
    (stroke.ctrl ? 4 : 0) +
    (stroke.super ? 8 : 0) +
    (stroke.hyper ? 16 : 0)
  const plain = modifier === 1
  const arrow = { up: "A", down: "B", right: "C", left: "D", home: "H", end: "F", f1: "P", f2: "Q", f3: "R", f4: "S" }[
    stroke.name
  ]
  const tilde = {
    insert: 2,
    delete: 3,
    pageup: 5,
    pagedown: 6,
    f5: 15,
    f6: 17,
    f7: 18,
    f8: 19,
    f9: 20,
    f10: 21,
    f11: 23,
    f12: 24,
  }[stroke.name]
  const code =
    { return: 13, tab: 9, escape: 27, backspace: 127, space: 32, kpenter: 57414 }[stroke.name] ??
    ([...stroke.name].length === 1 ? stroke.name.codePointAt(0) : undefined)
  if (arrow) {
    if (plain) return stroke.name.startsWith("f") ? `\x1bO${arrow}` : `\x1b[${arrow}`
    return `\x1b[1;${modifier}${arrow}`
  }
  if (tilde) return plain ? `\x1b[${tilde}~` : `\x1b[${tilde};${modifier}~`
  if (stroke.name === "linefeed") return csi || !plain ? undefined : "\n"
  if (code === undefined) return undefined
  if (csi) {
    if (plain && code !== 27 && code !== 57414 && code !== 127 && code !== 13 && code !== 9)
      return String.fromCodePoint(code)
    return plain ? `\x1b[${code}u` : `\x1b[${code};${modifier}u`
  }
  if (stroke.super || stroke.hyper || code === 27 || code === 57414) return undefined
  const named = { 13: "\r", 9: "\t", 127: "\x7f", 32: " " }[code]
  if (named) {
    if (stroke.ctrl) return undefined
    if (stroke.shift) return code === 9 && !stroke.meta ? "\x1b[Z" : undefined
    return (stroke.meta ? "\x1b" : "") + named
  }
  const character = String.fromCodePoint(code)
  if (stroke.ctrl) {
    if (stroke.shift || !/^[a-z]$/.test(character)) return undefined
    return (stroke.meta ? "\x1b" : "") + String.fromCharCode(code - 96)
  }
  const typed = stroke.shift ? (/^[a-z]$/.test(character) ? character.toUpperCase() : undefined) : character
  if (typed === undefined) return undefined
  return (stroke.meta ? "\x1b" : "") + typed
}

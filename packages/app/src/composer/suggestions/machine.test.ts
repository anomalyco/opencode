import { expect, test } from "bun:test"
import type { ComposerPersistedState, ComposerSuggestion } from "../types"
import {
  createComposerInteractionState,
  transitionComposer,
  type ComposerInteractionCommand,
  type ComposerInteractionEvent,
  type ComposerInteractionState,
} from "./machine"

const command: ComposerSuggestion = { id: "review", kind: "command", label: "/review" }

const file: ComposerSuggestion = { id: "src/index.ts", kind: "file", label: "index.ts", path: "src/index.ts" }

function persisted(value = "", cursor = value.length): ComposerPersistedState {
  return {
    prompt: [{ type: "text", content: value, start: 0, end: value.length }],
    cursor,
    context: { items: [] },
  }
}

function key(key: string, input: { ctrl?: boolean; ids?: string[]; empty?: boolean } = {}): ComposerInteractionEvent {
  return {
    type: "key.down",
    key,
    ctrl: input.ctrl ?? false,
    composing: false,
    ids: input.ids ?? [],
    empty: input.empty,
  }
}

const menu = { popover: { type: "command-menu", query: "" }, focus: "command-search" } as const

test.each<{
  name: string
  from?: Partial<ComposerInteractionState>
  event: ComposerInteractionEvent
  draft?: ComposerPersistedState
  popover?: ComposerInteractionState["popover"]
  focus?: ComposerInteractionState["focus"]
  mode?: ComposerInteractionState["mode"]
  command?: ComposerInteractionCommand
  handled?: true
}>([
  {
    name: "opens the searchable command menu for a populated draft",
    event: { type: "commands.open" },
    draft: persisted("existing text"),
    ...menu,
    command: { type: "focus.command-search" },
  },
  {
    name: "opens inline commands when slash is the entire prompt",
    event: { type: "input.changed", value: "/re" },
    popover: { type: "command-inline", query: "re" },
  },
  {
    name: "keeps inline commands closed when slash is not the entire prompt",
    event: { type: "input.changed", value: "explain /re" },
    popover: { type: "closed" },
  },
  {
    name: "opens nested slash command names",
    event: { type: "input.changed", value: "/review/" },
    popover: { type: "command-inline", query: "review/" },
  },
  {
    name: "completes nested slash command names",
    from: { popover: { type: "command-inline", query: "review/" } },
    event: { type: "popover.select", item: { ...command, label: "/review/nested" } },
    draft: persisted("/review/"),
    command: { type: "draft.setText", value: "/review/nested " },
  },
  {
    name: "opens context completion at the cursor",
    event: { type: "input.changed", value: "alpha @sr omega", persist: false },
    draft: persisted("alpha @sr omega", 9),
    popover: { type: "context", query: "sr" },
  },
  {
    name: "enters shell mode from an initial exclamation mark",
    event: { type: "input.changed", value: "!", persist: false },
    draft: persisted("!"),
    mode: "shell",
    command: { type: "draft.setText", value: "" },
  },
  {
    name: "leaves shell mode with escape",
    from: { mode: "shell" },
    event: key("Escape"),
    mode: "normal",
    handled: true,
  },
  {
    name: "leaves shell mode with backspace when empty",
    from: { mode: "shell" },
    event: key("Backspace", { empty: true }),
    mode: "normal",
    handled: true,
  },
  {
    name: "closes a popover with ctrl-g before stopping a run",
    from: { popover: { type: "context", query: "", activeID: "first" } },
    event: key("g", { ctrl: true, ids: ["first"] }),
    popover: { type: "closed" },
    handled: true,
  },
  {
    name: "prepends a menu command and preserves existing text as arguments",
    from: menu,
    event: { type: "popover.select", item: command },
    draft: persisted("existing text"),
    popover: { type: "closed" },
    command: { type: "draft.setText", value: "/review existing text" },
  },
  {
    name: "stores selected context files as prompt file parts",
    from: { popover: { type: "context", query: "index" } },
    event: { type: "popover.select", item: file },
    draft: persisted("@index"),
    command: { type: "mention.add", item: file },
  },
  {
    name: "loops active popover items with arrow keys",
    from: { popover: { type: "context", query: "", activeID: "second" } },
    event: key("ArrowDown", { ids: ["first", "second"] }),
    popover: { type: "context", query: "", activeID: "first" },
    handled: true,
  },
])("$name", (row) => {
  const result = transitionComposer(
    { ...createComposerInteractionState(), ...row.from },
    row.event,
    row.draft ?? persisted(),
  )

  if (row.popover) expect(result.state.popover).toEqual(row.popover)

  if (row.focus) expect(result.state.focus).toBe(row.focus)

  if (row.mode) expect(result.state.mode).toBe(row.mode)

  if (row.command) expect(result.commands).toContainEqual(row.command)
  expect(result.handled).toBe(row.handled ?? false)
})

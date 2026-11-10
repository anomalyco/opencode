import { expect, test } from "bun:test"
import type { ComposerHistoryEntry, ComposerPersistedState, ComposerSuggestion } from "../types"
import {
  composerHistoryPreviewHeight,
  createComposerInteractionState,
  transitionComposer,
  type ComposerInteractionCommand,
  type ComposerInteractionEvent,
  type ComposerInteractionState,
  type ComposerSavedDraft,
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
    name: "closes inline commands on a second press and takes back the slash it typed",
    from: { popover: { type: "command-inline", query: "" } },
    event: { type: "commands.open" },
    draft: persisted("/"),
    popover: { type: "closed" },
    command: { type: "draft.setText", value: "" },
  },
  {
    name: "closes inline commands on a second press and keeps a typed query",
    from: { popover: { type: "command-inline", query: "re" } },
    event: { type: "commands.open" },
    draft: persisted("/re"),
    popover: { type: "closed" },
    command: { type: "focus.editor" },
  },
  {
    name: "closes the command menu on a second press",
    from: menu,
    event: { type: "commands.open" },
    draft: persisted("existing text"),
    popover: { type: "closed" },
    focus: "editor",
  },
  {
    name: "closes the command menu when its empty search is backspaced",
    from: menu,
    event: key("Backspace"),
    draft: persisted("existing text"),
    popover: { type: "closed" },
    command: { type: "focus.editor" },
    handled: true,
  },
  {
    name: "keeps the command menu while its search has a query to delete",
    from: { popover: { type: "command-menu", query: "re" }, focus: "command-search" },
    event: key("Backspace"),
    draft: persisted("existing text"),
    popover: { type: "command-menu", query: "re" },
  },
  {
    name: "closes the command menu when the editor is typed in",
    from: menu,
    event: { type: "input.changed", value: "" },
    popover: { type: "closed" },
  },
  {
    name: "closes context on a second press and takes back the @ it typed",
    from: { popover: { type: "context", query: "" } },
    event: { type: "context.open" },
    draft: persisted("see @"),
    popover: { type: "closed" },
    command: { type: "draft.removeTextBefore", value: "@" },
  },
  {
    name: "closes context on a second press and keeps a typed query",
    from: { popover: { type: "context", query: "sr" } },
    event: { type: "context.open" },
    draft: persisted("see @sr"),
    popover: { type: "closed" },
    command: { type: "focus.editor" },
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
    name: "keeps an open mention searching across single spaces",
    from: { popover: { type: "context", query: "open" } },
    event: { type: "input.changed", value: "see @open con", persist: false },
    draft: persisted("see @open con"),
    popover: { type: "context", query: "open con" },
  },
  {
    name: "does not reopen a mention across a space",
    event: { type: "input.changed", value: "see @open con", persist: false },
    draft: persisted("see @open con"),
    popover: { type: "closed" },
  },
  {
    name: "ends an open mention at a double space",
    from: { popover: { type: "context", query: "open " } },
    event: { type: "input.changed", value: "see @open  ", persist: false },
    draft: persisted("see @open  "),
    popover: { type: "closed" },
  },
  {
    name: "enters shell mode from an initial exclamation mark",
    event: { type: "input.changed", value: "!", persist: false },
    draft: persisted("!"),
    command: { type: "draft.setMode", mode: "shell" },
  },
  {
    name: "leaves shell mode with escape",
    event: key("Escape"),
    draft: { ...persisted(), mode: "shell" },
    command: { type: "draft.setMode", mode: "normal" },
    handled: true,
  },
  {
    name: "leaves shell mode with backspace when empty",
    event: key("Backspace", { empty: true }),
    draft: { ...persisted(), mode: "shell" },
    command: { type: "draft.setMode", mode: "normal" },
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
    popover: { type: "context", query: "", activeID: "first", chosen: true },
    handled: true,
  },
  {
    name: "moves a highlight the user didn't choose to the first row when results reorder",
    from: { popover: { type: "context", query: "se", activeID: "server" } },
    event: { type: "popover.results", ids: ["session", "server"] },
    popover: { type: "context", query: "se", activeID: "session", chosen: false },
  },
  {
    name: "keeps a chosen highlight when results reorder",
    from: { popover: { type: "context", query: "se", activeID: "server", chosen: true } },
    event: { type: "popover.results", ids: ["session", "server"] },
    popover: { type: "context", query: "se", activeID: "server", chosen: true },
  },
  {
    name: "forgets the chosen highlight when the query changes",
    from: { popover: { type: "context", query: "se", activeID: "server", chosen: true } },
    event: { type: "input.changed", value: "@ses" },
    draft: persisted("@ses"),
    popover: { type: "context", query: "ses" },
  },
])("$name", (row) => {
  const result = transitionComposer(
    { ...createComposerInteractionState(), ...row.from },
    row.event,
    row.draft ?? persisted(),
  )

  if (row.popover) expect(result.state.popover).toEqual(row.popover)

  if (row.focus) expect(result.state.focus).toBe(row.focus)

  if (row.command) expect(result.commands).toContainEqual(row.command)
  expect(result.handled).toBe(row.handled ?? false)
})

const shot = { type: "path" as const, id: "shot", filename: "shot.png", mime: "image/png", path: "/tmp/shot.png" }

const other = { type: "path" as const, id: "other", filename: "other.png", mime: "image/png", path: "/tmp/other.png" }

// An empty-text draft with an attachment and a line comment (the host's history metadata).
const written: ComposerSavedDraft = { entry: { prompt: [...persisted().prompt, shot], metadata: ["c1"] }, cursor: 0 }

const entries: ComposerHistoryEntry[] = [
  { prompt: [...persisted().prompt, other] },
  { prompt: persisted("older").prompt },
]

function step(direction: "up" | "down", text = "", cursor = 0): ComposerInteractionEvent {
  return { type: "history.step", direction, text, cursor, entries, capture: () => written }
}

function browsing(index: number): ComposerInteractionState {
  return { ...createComposerInteractionState(), popover: { type: "browsing", index, saved: written }, focus: "editor" }
}

function history(height?: number): ComposerInteractionState {
  return {
    ...createComposerInteractionState(),
    popover: { type: "history", query: "", activeID: "history:0", saved: written, height },
    focus: "history-search",
  }
}

test("searching history from a recalled entry still cancels back to the draft the user wrote", () => {
  const recalled = transitionComposer(createComposerInteractionState(), step("up"), persisted())
  expect(recalled.state.popover).toEqual({ type: "browsing", index: 0, saved: written })
  expect(recalled.commands).toEqual([{ type: "history.apply", entry: entries[0], cursor: 0 }])

  // Shift+ArrowUp captures what the composer shows now: the recalled entry, not the draft.
  const shown: ComposerSavedDraft = { entry: entries[0]!, cursor: 0 }

  const opened = transitionComposer(
    recalled.state,
    { type: "history.open", id: "history:0", saved: shown },
    persisted(),
  )

  expect(opened.handled).toBe(true)
  expect(opened.state.popover).toMatchObject({ type: "history", saved: written })

  const cancelled = transitionComposer(opened.state, key("Escape"), persisted())
  expect(cancelled.state.popover).toEqual({ type: "closed" })
  expect(cancelled.commands).toEqual([{ type: "history.restore", draft: written, focus: true }])
})

test("a pointer outside a history preview or switching to shell restores the draft", () => {
  const dismissed = transitionComposer(history(), { type: "popover.dismiss" }, persisted())
  expect(dismissed.state).toMatchObject({ popover: { type: "closed" }, focus: "external" })
  expect(dismissed.commands).toEqual([{ type: "history.restore", draft: written, focus: false }])

  const shell = transitionComposer(history(), { type: "mode.shell" }, persisted())
  expect(shell.state.popover).toEqual({ type: "closed" })
  expect(shell.commands).toEqual([
    { type: "history.restore", draft: written, focus: false },
    { type: "draft.setMode", mode: "shell" },
  ])

  // Nothing is open to dismiss while browsing; the recalled entry stays.
  const idle = browsing(0)
  expect(transitionComposer(idle, { type: "popover.dismiss" }, persisted()).state).toBe(idle)
})

test("the preview height lives exactly as long as the history list", () => {
  const opened = transitionComposer(
    createComposerInteractionState(),
    { type: "history.open", id: "history:0", saved: written, height: 142 },
    persisted(),
  )

  expect(composerHistoryPreviewHeight(opened.state)).toBe(142)

  const select: ComposerInteractionEvent = {
    type: "popover.select",
    item: { id: "history:1", kind: "history", label: "older", history: entries[1] },
  }

  const exits: ComposerInteractionEvent[] = [
    key("Escape"),
    key("Tab"),
    select,
    { type: "popover.dismiss" },
    { type: "history.reset" },
  ]

  for (const event of exits)
    expect(composerHistoryPreviewHeight(transitionComposer(history(142), event, persisted()).state)).toBeUndefined()

  expect(transitionComposer(history(142), select, persisted()).commands).toEqual([
    { type: "history.apply", entry: entries[1] },
  ])
})

test("plain arrows browse history within its bounds and back to the written draft", () => {
  const oldest = browsing(1)
  const clamped = transitionComposer(oldest, step("up"), persisted("older"))
  expect(clamped.state).toBe(oldest)
  expect(clamped.handled).toBe(false)

  const newer = transitionComposer(oldest, step("down", "older", 5), persisted("older"))
  expect(newer.state.popover).toEqual({ type: "browsing", index: 0, saved: written })
  expect(newer.commands).toEqual([{ type: "history.apply", entry: entries[0] }])

  const back = transitionComposer(browsing(0), step("down"), persisted())
  expect(back.state.popover).toEqual({ type: "closed" })
  expect(back.commands).toEqual([{ type: "history.restore", draft: written, focus: true }])

  // The caret must sit at an edge of a recalled entry, and at the start of an empty draft to begin.
  expect(transitionComposer(oldest, step("down", "older", 2), persisted("older")).state).toBe(oldest)
  const typed = createComposerInteractionState()
  expect(transitionComposer(typed, step("up", "draft", 0), persisted("draft")).state).toBe(typed)
  expect(transitionComposer(typed, step("down"), persisted()).state).toBe(typed)
})

test("editing a recalled entry makes it the draft", () => {
  const typed = transitionComposer(
    browsing(0),
    { type: "input.changed", value: "edit", persist: false },
    persisted("edit"),
  )

  expect(typed.state.popover).toEqual({ type: "closed" })
  expect(typed.commands).toEqual([])

  expect(transitionComposer(browsing(0), { type: "draft.edited" }, persisted()).state.popover).toEqual({
    type: "closed",
  })

  const idle = createComposerInteractionState()
  expect(transitionComposer(idle, { type: "draft.edited" }, persisted()).state).toBe(idle)
})

test("typing with nothing open keeps the same state and asks for nothing", () => {
  const idle: ComposerInteractionState = { ...createComposerInteractionState(), focus: "editor" }
  const typed = transitionComposer(idle, { type: "input.changed", value: "hello", persist: false }, persisted("hello"))
  expect(typed.state).toBe(idle)
  expect(typed.commands).toEqual([])
  expect(transitionComposer(idle, key("a"), persisted("hello")).state).toBe(idle)
})

test("the draft's mode is the only mode, and an outside change ends browsing", () => {
  const shell: ComposerPersistedState = { ...persisted(), mode: "shell" }
  expect(transitionComposer(createComposerInteractionState(), { type: "mode.shell" }, shell).commands).toEqual([])

  const left = transitionComposer(browsing(0), { type: "mode.normal" }, shell)
  expect(left.state.popover).toEqual({ type: "closed" })
  expect(left.commands).toEqual([{ type: "draft.setMode", mode: "normal" }])

  const escaped = transitionComposer(browsing(0), key("Escape"), shell)
  expect(escaped.state.popover).toEqual({ type: "closed" })
  expect(escaped.commands).toEqual([{ type: "draft.setMode", mode: "normal" }])

  // A queue edit or a send writes the mode and the draft together, so nothing is restored over them.
  for (const state of [browsing(0), history()]) {
    const synced = transitionComposer(state, { type: "mode.synced", mode: "shell" }, shell)
    expect(synced.state.popover).toEqual({ type: "closed" })
    expect(synced.commands).toEqual([])
  }

  const context: ComposerInteractionState = {
    ...createComposerInteractionState(),
    popover: { type: "context", query: "" },
  }

  expect(transitionComposer(context, { type: "mode.synced", mode: "normal" }, persisted()).state).toBe(context)
  expect(transitionComposer(context, { type: "mode.synced", mode: "shell" }, shell).state.popover).toEqual({
    type: "closed",
  })
})

import type { ComposerHistoryEntry, ComposerPersistedState, ComposerSuggestion } from "../types"
import { isAttachment } from "../prompt-parts"

export type ComposerMode = "normal" | "shell"

/** The draft history replaced, put back when the user browses past the newest entry or cancels a preview. */
export type ComposerSavedDraft = {
  readonly entry: ComposerHistoryEntry
  readonly cursor: number | undefined
}

export type ComposerPopoverState =
  | { readonly type: "closed" }
  // Plain arrows recall history entries into the draft, with no list open.
  | { readonly type: "browsing"; readonly index: number; readonly saved: ComposerSavedDraft }
  | { readonly type: "context"; readonly query: string; readonly activeID?: string; readonly chosen?: boolean }
  | { readonly type: "command-inline"; readonly query: string; readonly activeID?: string; readonly chosen?: boolean }
  | { readonly type: "command-menu"; readonly query: string; readonly activeID?: string; readonly chosen?: boolean }
  | {
      readonly type: "history"
      readonly query: string
      readonly activeID?: string
      readonly chosen?: boolean
      readonly saved: ComposerSavedDraft
      /** The composer's height when the list opened, held while previews of other sizes replace the draft. */
      readonly height?: number
    }

type OpenPopover = Exclude<ComposerPopoverState, { type: "closed" } | { type: "browsing" }>

// The draft's `mode` is the only record of the composer mode; the machine reads it and asks for changes.
export type ComposerInteractionState = {
  readonly popover: ComposerPopoverState
  readonly drag: "idle" | "active"
  readonly focus: "editor" | "command-search" | "history-search" | "external"
  readonly activeContextID?: string
}

export type ComposerInteractionEvent =
  | { readonly type: "input.changed"; readonly value: string; readonly persist?: boolean }
  /** The draft changed outside typing (an attachment or a comment); recalled history becomes the draft. */
  | { readonly type: "draft.edited" }
  | { readonly type: "commands.open" }
  | { readonly type: "context.open" }
  | { readonly type: "history.open"; readonly id: string; readonly saved: ComposerSavedDraft; readonly height?: number }
  | {
      readonly type: "history.step"
      readonly direction: "up" | "down"
      readonly text: string
      readonly cursor: number
      readonly entries: readonly ComposerHistoryEntry[]
      /** Read only when browsing starts, so other arrow presses copy nothing. */
      readonly capture: () => ComposerSavedDraft
    }
  /** Ends browsing or a preview without putting the draft back: a send or another draft replaced it. */
  | { readonly type: "history.reset" }
  | { readonly type: "popover.query"; readonly value: string }
  | { readonly type: "popover.results"; readonly ids: readonly string[] }
  | { readonly type: "popover.active"; readonly id: string }
  | { readonly type: "popover.close" }
  /** A pointer or focus outside the list; a history preview puts the draft back. */
  | { readonly type: "popover.dismiss" }
  | { readonly type: "popover.select"; readonly item: ComposerSuggestion }
  | {
      readonly type: "key.down"
      readonly key: string
      readonly ctrl: boolean
      readonly composing: boolean
      readonly ids: readonly string[]
      readonly empty?: boolean
    }
  | { readonly type: "mode.shell" }
  | { readonly type: "mode.normal" }
  /** Something other than this machine wrote the draft's mode: hydration, a queue edit or a send. */
  | { readonly type: "mode.synced"; readonly mode: ComposerMode }
  | { readonly type: "drag.enter" }
  | { readonly type: "drag.leave" }
  | { readonly type: "focus.editor" }
  | { readonly type: "focus.external" }
  | { readonly type: "context.active"; readonly id: string }

export type ComposerInteractionCommand =
  | { readonly type: "draft.setMode"; readonly mode: ComposerMode }
  | { readonly type: "draft.setText"; readonly value: string }
  | { readonly type: "draft.addText"; readonly value: string }
  | { readonly type: "draft.removeTextBefore"; readonly value: string }
  | { readonly type: "mention.add"; readonly item: ComposerSuggestion; readonly range?: { start: number; end: number } }
  | { readonly type: "popover.filter"; readonly popover: "command" | "context"; readonly query: string }
  | { readonly type: "suggestion.select"; readonly id: string }
  | { readonly type: "focus.editor" }
  | { readonly type: "focus.command-search" }
  | { readonly type: "history.preview"; readonly id: string }
  | { readonly type: "history.apply"; readonly entry: ComposerHistoryEntry; readonly cursor?: number }
  | { readonly type: "history.restore"; readonly draft: ComposerSavedDraft; readonly focus: boolean }

export type ComposerEditorTransition = {
  readonly state: ComposerInteractionState
  readonly commands: readonly ComposerInteractionCommand[]
  readonly handled: boolean
}

const CLOSED: ComposerPopoverState = Object.freeze({ type: "closed" })

const NO_COMMANDS: readonly ComposerInteractionCommand[] = Object.freeze([])

const SHELL: ComposerInteractionCommand = Object.freeze({ type: "draft.setMode", mode: "shell" })

const NORMAL: ComposerInteractionCommand = Object.freeze({ type: "draft.setMode", mode: "normal" })

export function createComposerInteractionState(): ComposerInteractionState {
  return { popover: CLOSED, drag: "idle", focus: "external" }
}

export function selectComposerMode(persisted: Pick<ComposerPersistedState, "mode">): ComposerMode {
  return persisted.mode ?? "normal"
}

/** Whether a suggestion list shows; browsing history shows none. */
export function isComposerPopoverOpen(
  state: ComposerInteractionState,
): state is ComposerInteractionState & { popover: OpenPopover } {
  return state.popover.type !== "closed" && state.popover.type !== "browsing"
}

export function composerPopoverActiveID(state: ComposerInteractionState) {
  return isComposerPopoverOpen(state) ? state.popover.activeID : undefined
}

export function composerHistoryPreviewHeight(state: ComposerInteractionState) {
  return state.popover.type === "history" ? state.popover.height : undefined
}

export function transitionComposer(
  state: ComposerInteractionState,
  event: ComposerInteractionEvent,
  persisted: ComposerPersistedState,
): ComposerEditorTransition {
  if (event.type === "input.changed") return inputChanged(state, event.value, event.persist !== false, persisted)

  if (event.type === "draft.edited")
    return state.popover.type === "browsing" ? changed({ ...state, popover: CLOSED }) : unchanged(state)

  if (event.type === "commands.open") return openCommands(state, persisted)

  if (event.type === "context.open") return openContext(state)

  if (event.type === "history.open") return openHistory(state, event)

  if (event.type === "history.step") return stepHistory(state, event)

  if (event.type === "history.reset" || event.type === "popover.close")
    return state.popover.type === "closed" ? unchanged(state) : changed({ ...state, popover: CLOSED })

  if (event.type === "popover.dismiss") {
    if (state.popover.type === "history")
      return changed({ ...state, popover: CLOSED, focus: "external" }, [
        { type: "history.restore", draft: state.popover.saved, focus: false },
      ])

    if (!isComposerPopoverOpen(state)) return unchanged(state)

    return changed({ ...state, popover: CLOSED, focus: "external" })
  }

  if (event.type === "popover.query") return queryChanged(state, event.value)

  if (event.type === "popover.results") return resultsChanged(state, event.ids)

  if (event.type === "popover.active") return activeChanged(state, event.id)

  if (event.type === "popover.select") return suggestionSelected(state, event.item, persisted)

  if (event.type === "key.down") return keyDown(state, event, selectComposerMode(persisted))

  if (event.type === "mode.shell") return enterShell(state, selectComposerMode(persisted))

  if (event.type === "mode.normal") return leaveShell(state, selectComposerMode(persisted))

  // A recalled entry or preview belongs to the other mode's history, and the draft's new owner replaced it.
  if (event.type === "mode.synced") {
    if (state.popover.type === "closed") return unchanged(state)

    if (event.mode === "normal" && isComposerPopoverOpen(state) && state.popover.type !== "history")
      return unchanged(state)

    return changed({ ...state, popover: CLOSED })
  }

  if (event.type === "drag.enter")
    return state.drag === "active" ? unchanged(state) : changed({ ...state, drag: "active" })

  if (event.type === "drag.leave") return state.drag === "idle" ? unchanged(state) : changed({ ...state, drag: "idle" })

  if (event.type === "focus.editor")
    return state.focus === "editor" ? unchanged(state) : changed({ ...state, focus: "editor" })

  if (event.type === "context.active") {
    return changed({ ...state, activeContextID: state.activeContextID === event.id ? undefined : event.id })
  }

  return state.focus === "external" ? unchanged(state) : changed({ ...state, focus: "external" })
}

function inputChanged(
  state: ComposerInteractionState,
  value: string,
  persist: boolean,
  persisted: ComposerPersistedState,
): ComposerEditorTransition {
  if (selectComposerMode(persisted) === "normal" && value === "!") {
    return changed({ ...state, popover: CLOSED, focus: "editor" }, [SHELL, { type: "draft.setText", value: "" }])
  }

  // An open mention keeps single spaces so multi-word session titles stay searchable.
  const context = value.includes("@")
    ? value
        .slice(0, persisted.cursor ?? value.length)
        .match(state.popover.type === "context" ? /(?:^|\s)@((?:[^\s@]+(?: [^\s@]+)* ?)?)$/ : /(?:^|\s)@([^\s@]*)$/)
    : null

  if (context) {
    const query = context[1] ?? ""

    return changed({ ...state, popover: { type: "context", query }, focus: "editor" }, [
      ...(persist ? [{ type: "draft.setText" as const, value }] : []),
      { type: "popover.filter", popover: "context", query },
    ])
  }

  const command = value.startsWith("/") ? value.match(/^\/(\S*)$/) : null

  if (command) {
    const query = command[1] ?? ""

    return changed({ ...state, popover: { type: "command-inline", query }, focus: "editor" }, [
      ...(persist ? [{ type: "draft.setText" as const, value }] : []),
      { type: "popover.filter", popover: "command", query },
    ])
  }

  const commands = persist ? [{ type: "draft.setText" as const, value }] : NO_COMMANDS

  // Typing is the hot path: plain text in a composer with nothing open changes nothing here.
  if (state.popover.type === "closed" && state.focus === "editor") return unchanged(state, false, commands)

  // Typing in the editor leaves the command menu, whose own search field takes its input, and makes recalled history
  // the draft.
  return changed({ ...state, popover: CLOSED, focus: "editor" }, commands)
}

function openCommands(state: ComposerInteractionState, persisted: ComposerPersistedState): ComposerEditorTransition {
  // A second press closes the commands, taking back the slash the first one typed.
  if (state.popover.type === "command-inline" || state.popover.type === "command-menu") {
    const typed = state.popover.type === "command-inline" && promptText(persisted) === "/"

    return changed({ ...state, popover: CLOSED, focus: "editor" }, [
      ...(typed ? [{ type: "draft.setText" as const, value: "" }] : []),
      { type: "focus.editor" },
    ])
  }

  if (!populated(persisted)) {
    return changed({ ...state, popover: { type: "command-inline", query: "" }, focus: "editor" }, [
      { type: "draft.addText", value: "/" },
      { type: "popover.filter", popover: "command", query: "" },
      { type: "focus.editor" },
    ])
  }

  return changed({ ...state, popover: { type: "command-menu", query: "" }, focus: "command-search" }, [
    { type: "popover.filter", popover: "command", query: "" },
    { type: "focus.command-search" },
  ])
}

function openContext(state: ComposerInteractionState): ComposerEditorTransition {
  // A second press closes the context list, taking back the @ it typed when nothing follows it yet.
  if (state.popover.type === "context") {
    return changed({ ...state, popover: CLOSED, focus: "editor" }, [
      ...(state.popover.query ? [] : [{ type: "draft.removeTextBefore" as const, value: "@" }]),
      { type: "focus.editor" },
    ])
  }

  return changed({ ...state, popover: { type: "context", query: "" }, focus: "editor" }, [
    { type: "draft.addText", value: "@" },
    { type: "popover.filter", popover: "context", query: "" },
    { type: "focus.editor" },
  ])
}

function openHistory(
  state: ComposerInteractionState,
  event: Extract<ComposerInteractionEvent, { type: "history.open" }>,
): ComposerEditorTransition {
  if (isComposerPopoverOpen(state)) return unchanged(state)

  return changed(
    {
      ...state,
      popover: {
        type: "history",
        query: "",
        activeID: event.id,
        // Searching from a recalled entry still cancels back to the draft the user wrote, not the entry.
        saved: state.popover.type === "browsing" ? state.popover.saved : event.saved,
        height: event.height,
      },
      focus: "history-search",
    },
    [{ type: "history.preview", id: event.id }],
    true,
  )
}

function stepHistory(
  state: ComposerInteractionState,
  event: Extract<ComposerInteractionEvent, { type: "history.step" }>,
): ComposerEditorTransition {
  if (isComposerPopoverOpen(state)) return unchanged(state)
  const browsing = state.popover.type === "browsing" ? state.popover : undefined

  if (!canNavigateHistory(event.direction, event.text, event.cursor, !!browsing)) return unchanged(state)

  if (event.direction === "up") {
    const index = browsing ? browsing.index + 1 : 0
    const entry = event.entries[index]

    if (!entry) return unchanged(state)

    return changed(
      { ...state, popover: { type: "browsing", index, saved: browsing?.saved ?? event.capture() }, focus: "editor" },
      [{ type: "history.apply", entry, cursor: 0 }],
      true,
    )
  }

  if (!browsing) return unchanged(state)

  if (browsing.index === 0)
    return changed(
      { ...state, popover: CLOSED, focus: "editor" },
      [{ type: "history.restore", draft: browsing.saved, focus: true }],
      true,
    )
  const entry = event.entries[browsing.index - 1]

  if (!entry) return unchanged(state)

  return changed(
    { ...state, popover: { ...browsing, index: browsing.index - 1 }, focus: "editor" },
    [{ type: "history.apply", entry }],
    true,
  )
}

function queryChanged(state: ComposerInteractionState, query: string): ComposerEditorTransition {
  if (!isComposerPopoverOpen(state)) return unchanged(state)

  if (state.popover.type === "history")
    return changed({ ...state, popover: { ...state.popover, query, activeID: undefined, chosen: undefined } })

  const popover = state.popover.type === "context" ? "context" : "command"

  return changed({ ...state, popover: { ...state.popover, query, activeID: undefined, chosen: undefined } }, [
    { type: "popover.filter", popover, query },
  ])
}

function resultsChanged(state: ComposerInteractionState, ids: readonly string[]): ComposerEditorTransition {
  if (!isComposerPopoverOpen(state)) return unchanged(state)

  // Until the user picks a row, the highlight follows the first row as results arrive and reorder.
  const kept =
    !!state.popover.activeID &&
    ids.includes(state.popover.activeID) &&
    (state.popover.chosen || state.popover.type === "history")

  const activeID = kept ? state.popover.activeID : ids[0]

  if (activeID === state.popover.activeID) return unchanged(state)

  return changed(
    { ...state, popover: { ...state.popover, activeID, chosen: kept && state.popover.chosen } },
    state.popover.type === "history" && activeID ? [{ type: "history.preview", id: activeID }] : NO_COMMANDS,
  )
}

function activeChanged(state: ComposerInteractionState, id: string): ComposerEditorTransition {
  if (!isComposerPopoverOpen(state) || (state.popover.activeID === id && state.popover.chosen)) return unchanged(state)

  return changed(
    { ...state, popover: { ...state.popover, activeID: id, chosen: true } },
    state.popover.type === "history" ? [{ type: "history.preview", id }] : NO_COMMANDS,
  )
}

function suggestionSelected(
  state: ComposerInteractionState,
  item: ComposerSuggestion,
  persisted: ComposerPersistedState,
): ComposerEditorTransition {
  if (item.kind === "history") {
    if (state.popover.type !== "history" || !item.history) return unchanged(state)

    return changed(
      { ...state, popover: CLOSED, focus: "editor" },
      [{ type: "history.apply", entry: item.history }],
      true,
    )
  }

  const current = promptText(persisted)
  const commands: ComposerInteractionCommand[] = []

  if (item.kind === "command") {
    commands.push({
      type: "draft.setText",
      value:
        state.popover.type === "command-menu"
          ? current.trim()
            ? `${item.label} ${current.trim()}`
            : `${item.label} `
          : replaceTrigger(current, "/", `${item.label} `),
    })
  } else {
    commands.push({
      type: "mention.add",
      item,
      range:
        item.kind === "skill" && item.label.startsWith("/")
          ? { start: 0, end: state.popover.type === "command-menu" ? 0 : current.length }
          : undefined,
    })
  }

  commands.push({ type: "focus.editor" })

  return changed({ ...state, popover: CLOSED, focus: "editor" }, commands)
}

function keyDown(
  state: ComposerInteractionState,
  event: Extract<ComposerInteractionEvent, { type: "key.down" }>,
  mode: ComposerMode,
): ComposerEditorTransition {
  if (state.popover.type === "history" && (event.key === "Escape" || (event.ctrl && event.key.toLowerCase() === "g"))) {
    return changed(
      { ...state, popover: CLOSED, focus: "editor" },
      [{ type: "history.restore", draft: state.popover.saved, focus: true }],
      true,
    )
  }

  if (!isComposerPopoverOpen(state)) {
    if (mode === "shell" && (event.key === "Escape" || (event.key === "Backspace" && event.empty))) {
      return changed(state.popover.type === "closed" ? state : { ...state, popover: CLOSED }, [NORMAL], true)
    }

    return unchanged(state)
  }

  if (event.ctrl && event.key.toLowerCase() === "g")
    return changed({ ...state, popover: CLOSED, focus: "editor" }, [{ type: "focus.editor" }], true)

  // Backspace on an empty search backs out of the command menu, as it closes inline commands by deleting their slash.
  // iOS does not move the keyboard to the search field the menu focuses, so the key can arrive from the editor; it is
  // handled there too, so backing out never also deletes from the draft.
  if (event.key === "Backspace" && state.popover.type === "command-menu" && !state.popover.query) {
    return changed({ ...state, popover: CLOSED, focus: "editor" }, [{ type: "focus.editor" }], true)
  }

  // Tab keeps the previewed entry as the draft.
  if (event.key === "Escape" || (state.popover.type === "history" && event.key === "Tab")) {
    return changed({ ...state, popover: CLOSED, focus: "editor" }, [{ type: "focus.editor" }], true)
  }

  if (event.key === "Tab" || (event.key === "Enter" && !event.composing)) {
    if (!state.popover.activeID) return unchanged(state, true)

    return unchanged(state, true, [{ type: "suggestion.select", id: state.popover.activeID }])
  }

  const direction =
    event.key === "ArrowDown" || (event.ctrl && event.key === "n")
      ? 1
      : event.key === "ArrowUp" || (event.ctrl && event.key === "p")
        ? -1
        : 0

  if (!direction || event.ids.length === 0) return unchanged(state)
  const current = state.popover.activeID ? event.ids.indexOf(state.popover.activeID) : -1

  const index =
    current < 0
      ? direction === 1
        ? 0
        : event.ids.length - 1
      : (current + direction + event.ids.length) % event.ids.length

  const next =
    state.popover.type === "history" && current >= 0
      ? Math.max(0, Math.min(event.ids.length - 1, current + direction))
      : index

  return changed(
    { ...state, popover: { ...state.popover, activeID: event.ids[next], chosen: true } },
    state.popover.type === "history" ? [{ type: "history.preview", id: event.ids[next]! }] : NO_COMMANDS,
    true,
  )
}

function enterShell(state: ComposerInteractionState, mode: ComposerMode): ComposerEditorTransition {
  if (mode === "shell" && state.popover.type === "closed") return unchanged(state)

  // A history preview is cancelled, not kept: its entry belongs to the prompt history.
  return changed({ ...state, popover: CLOSED }, [
    ...(state.popover.type === "history"
      ? [{ type: "history.restore" as const, draft: state.popover.saved, focus: false }]
      : []),
    ...(mode === "shell" ? [] : [SHELL]),
  ])
}

function leaveShell(state: ComposerInteractionState, mode: ComposerMode): ComposerEditorTransition {
  if (mode === "normal") return unchanged(state)

  return changed(state.popover.type === "browsing" ? { ...state, popover: CLOSED } : state, [NORMAL])
}

function canNavigateHistory(direction: "up" | "down", text: string, cursor: number, browsing: boolean) {
  const position = Math.max(0, Math.min(cursor, text.length))

  if (browsing) return position === 0 || position === text.length

  if (direction === "up") return position === 0 && text.length === 0

  return position === text.length
}

function promptText(persisted: ComposerPersistedState) {
  return persisted.prompt.map((part) => (part.type === "text" ? part.content : "")).join("")
}

function populated(persisted: ComposerPersistedState) {
  return (
    !!promptText(persisted).trim() ||
    persisted.context.items.length > 0 ||
    persisted.prompt.some((part) => part.type === "file" || isAttachment(part))
  )
}

function replaceTrigger(value: string, trigger: "@" | "/", replacement: string) {
  const index = trigger === "/" ? value.indexOf(trigger) : value.lastIndexOf(trigger)

  return index < 0 ? replacement : value.slice(0, index) + replacement
}

function changed(
  state: ComposerInteractionState,
  commands: readonly ComposerInteractionCommand[] = NO_COMMANDS,
  handled = false,
): ComposerEditorTransition {
  return { state, commands, handled }
}

function unchanged(
  state: ComposerInteractionState,
  handled = false,
  commands: readonly ComposerInteractionCommand[] = NO_COMMANDS,
): ComposerEditorTransition {
  return { state, commands, handled }
}

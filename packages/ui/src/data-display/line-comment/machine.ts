export const MENTION_LIMIT = 10

/** A file search that never answers stops holding Enter and Tab after this long. */
export const MENTION_TIMEOUT_MS = 5_000

/** The `@query` the caret sits at the end of, and where it starts and ends in the value. */
export type MentionToken = {
  readonly query: string
  readonly start: number
  readonly end: number
}

/** The editor props the machine reads, captured when the event happens. */
export type LineCommentEditorConfig = {
  readonly value: string
  readonly allowEmpty: boolean
  readonly variant: "default" | "compact"
  readonly alternateSubmit: { readonly disabled: boolean } | null
  readonly submitting: boolean
}

/**
 * `alternate` is whether Mod is held over a compact editor with an alternate submit. `attempt` counts mention
 * searches; only the search a `mention-loading` state started may settle it.
 */
export type LineCommentEditorState =
  | {
      readonly status: "editing"
      readonly attempt: number
      readonly alternate: boolean
      /** A token the user closed with Escape, or that found nothing, stays closed while the caret stays on it. */
      readonly dismissed: { readonly start: number; readonly query: string } | null
    }
  | {
      readonly status: "mention-loading"
      readonly attempt: number
      readonly alternate: boolean
      readonly token: MentionToken
      /** The previous results while the user refines the same token, so the list does not flash between keystrokes. */
      readonly items: readonly string[]
      readonly activeIndex: number
    }
  | {
      readonly status: "mention-open"
      readonly attempt: number
      readonly alternate: boolean
      readonly token: MentionToken
      /** Never empty, and at most `MENTION_LIMIT`: every item is on screen. */
      readonly items: readonly string[]
      readonly activeIndex: number
    }
  /** The owner set `submitting`: the draft is read-only until it clears. */
  | { readonly status: "submitting"; readonly attempt: number; readonly alternate: boolean }
  | { readonly status: "disposed" }

export type LineCommentEditorKey = {
  readonly key: string
  readonly ctrl: boolean
  readonly meta: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly repeat: boolean
}

export type LineCommentEditorEvent =
  /** Props changed, or the owner replaced the value; `token` is read from the textarea after the change. */
  | { readonly type: "props.synced"; readonly config: LineCommentEditorConfig; readonly token: MentionToken | null }
  /** The user typed or moved the caret. `token` is null without a `mention` prop. */
  | { readonly type: "mention.synced"; readonly token: MentionToken | null }
  | { readonly type: "mention.loaded"; readonly attempt: number; readonly items: readonly string[] }
  | { readonly type: "mention.failed"; readonly attempt: number }
  | { readonly type: "mention.timeout"; readonly attempt: number }
  | { readonly type: "mention.hovered"; readonly index: number }
  | { readonly type: "mention.selected"; readonly index: number }
  | { readonly type: "modifier.changed"; readonly active: boolean; readonly config: LineCommentEditorConfig }
  | { readonly type: "window.blurred" }
  /** A key outside an IME composition, in the textarea or on the compact action. */
  | (LineCommentEditorKey & {
      readonly type: "key.down"
      readonly target: "textarea" | "action"
      readonly config: LineCommentEditorConfig
    })
  | { readonly type: "action.clicked"; readonly modified: boolean; readonly config: LineCommentEditorConfig }
  /** The default layout's Submit button. */
  | { readonly type: "submit.requested"; readonly config: LineCommentEditorConfig }
  /** The default layout's Cancel button. */
  | { readonly type: "cancel.requested" }
  | { readonly type: "disposed" }

export type LineCommentEditorEffect =
  | { readonly type: "mention.load"; readonly attempt: number; readonly query: string }
  | { readonly type: "mention.insert"; readonly path: string; readonly token: MentionToken }
  | { readonly type: "submit"; readonly mode: "primary" | "alternate"; readonly value: string }
  | { readonly type: "cancel"; readonly blur: boolean }

export type LineCommentEditorTransition = {
  readonly state: LineCommentEditorState
  readonly effects: readonly LineCommentEditorEffect[]
  /** The key event belongs to the editor: the driver calls `preventDefault()`. */
  readonly handled: boolean
}

type Live = Exclude<LineCommentEditorState, { status: "disposed" | "submitting" }>

const NO_EFFECTS: readonly LineCommentEditorEffect[] = Object.freeze([])

export function createLineCommentEditorState(): LineCommentEditorState {
  return { status: "editing", attempt: 0, alternate: false, dismissed: null }
}

/** The mention token the caret sits at the end of, or null for a selection, a bare `@`, or no `@` at all. */
export function parseMentionToken(
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): MentionToken | null {
  if (selectionStart === null || selectionStart !== selectionEnd) return null
  const match = value.slice(0, selectionStart).match(/@(\S*)$/)

  if (!match?.[1]?.trim()) return null

  return { query: match[1], start: selectionStart - match[0].length, end: selectionStart }
}

export function transitionLineCommentEditor(
  state: LineCommentEditorState,
  event: LineCommentEditorEvent,
): LineCommentEditorTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: NO_EFFECTS, handled: false }

  if (event.type === "props.synced") return syncProps(state, event.config, event.token)

  if (event.type === "modifier.changed") {
    return withAlternate(state, event.active && allowsAlternate(event.config))
  }

  if (event.type === "window.blurred") return withAlternate(state, false)

  if (state.status === "submitting") {
    if (event.type !== "key.down") return unchanged(state)

    return { state, effects: NO_EFFECTS, handled: ownsKey(event, event.target, event.config) }
  }

  if (event.type === "mention.synced") return syncToken(state, event.token)

  if (event.type === "mention.loaded") {
    if (state.status !== "mention-loading" || event.attempt !== state.attempt) return unchanged(state)
    const items = event.items.slice(0, MENTION_LIMIT)

    if (items.length === 0) return settle(editing(state, state.token))

    return settle({ ...state, status: "mention-open", items, activeIndex: 0 })
  }

  if (event.type === "mention.failed" || event.type === "mention.timeout") {
    if (state.status !== "mention-loading" || event.attempt !== state.attempt) return unchanged(state)

    return settle(editing(state, null))
  }

  if (event.type === "mention.hovered") {
    if (state.status === "editing" || !state.items[event.index] || state.activeIndex === event.index) {
      return unchanged(state)
    }

    return settle({ ...state, activeIndex: event.index })
  }

  if (event.type === "mention.selected") {
    if (state.status === "editing") return unchanged(state)

    return insert(state, event.index)
  }

  if (event.type === "action.clicked") {
    const alternate = event.modified && event.config.alternateSubmit !== null

    if (!alternate && !canSubmit(event.config)) return cancel(state, false)

    return submit(state, event.config, alternate)
  }

  if (event.type === "submit.requested") return submit(state, event.config, false)

  if (event.type === "cancel.requested") return cancel(state, false)

  if (event.target === "action") return actionKey(state, event, event.config)

  return textareaKey(state, event, event.config)
}

export function viewLineCommentEditor(state: LineCommentEditorState, config: LineCommentEditorConfig) {
  const submitting = state.status === "submitting"
  const submittable = canSubmit(config)
  const alternateActive = state.status !== "disposed" && state.alternate && config.alternateSubmit !== null
  const mentionItems = state.status === "mention-open" || state.status === "mention-loading" ? state.items : []

  return {
    submitting,
    canSubmit: submittable,
    compactCancel: !submittable,
    alternateActive,
    trackModifiers: state.status !== "disposed" && allowsAlternate(config),
    compactVariant: alternateActive || submitting ? "submit" : config.value.trim() ? "neutral" : "ghost-muted",
    compactDisabled: submitting || (alternateActive && !!config.alternateSubmit?.disabled),
    mentionItems,
    activeMentionPath:
      state.status === "mention-open" || state.status === "mention-loading"
        ? (state.items[state.activeIndex] ?? null)
        : null,
  } as const
}

function textareaKey(state: Live, key: LineCommentEditorKey, config: LineCommentEditorConfig) {
  // The list is on screen: a fresh result, or the previous one while a refined query loads.
  const listed = state.status !== "editing" && state.items.length > 0

  if (key.key === "Escape") {
    if (listed) return settle(editing(state, state.token), true)

    return cancel(state, true)
  }

  if (key.key === "Enter" && !key.shift) {
    if (modifiedKey(key) && config.alternateSubmit) return key.repeat ? handled(state) : submit(state, config, true)

    if (state.status === "mention-open") return insert(state, state.activeIndex)

    // The previous query's list is on screen while the refined one loads: picking from it would insert a stale path.
    if (listed) return handled(state)

    return key.repeat ? handled(state) : submit(state, config, false)
  }

  if (key.key === "Tab" && !key.alt && !key.ctrl && !key.meta) {
    if (state.status === "mention-open") return insert(state, state.activeIndex)

    if (listed) return handled(state)

    return unchanged(state)
  }

  const step = navigation(key)

  if (step === 0 || !listed) return unchanged(state)

  return settle({ ...state, activeIndex: (state.activeIndex + step + state.items.length) % state.items.length }, true)
}

function actionKey(state: Live, key: LineCommentEditorKey, config: LineCommentEditorConfig) {
  if (key.key === "Enter" && modifiedKey(key) && config.alternateSubmit) {
    return key.repeat ? handled(state) : submit(state, config, true)
  }

  if (key.key === "Escape") return cancel(state, false)

  return unchanged(state)
}

/** Whether a read-only, submitting editor still swallows the key so it cannot leave through a parent handler. */
function ownsKey(key: LineCommentEditorKey, target: "textarea" | "action", config: LineCommentEditorConfig) {
  if (key.key === "Escape") return true

  if (target === "textarea") return key.key === "Enter" && !key.shift

  return key.key === "Enter" && modifiedKey(key) && config.alternateSubmit !== null
}

function syncProps(
  state: Exclude<LineCommentEditorState, { status: "disposed" }>,
  config: LineCommentEditorConfig,
  token: MentionToken | null,
): LineCommentEditorTransition {
  const alternate = state.alternate && allowsAlternate(config)

  if (config.submitting) {
    if (state.status === "submitting" && state.alternate === alternate) return unchanged(state)

    return settle({ status: "submitting", attempt: state.attempt, alternate })
  }

  if (state.status === "submitting")
    return settle({ status: "editing", attempt: state.attempt, alternate, dismissed: null })

  return syncToken(alternate === state.alternate ? state : { ...state, alternate }, token)
}

function syncToken(state: Live, token: MentionToken | null): LineCommentEditorTransition {
  if (!token) {
    if (state.status === "editing" && state.dismissed === null) return unchanged(state)

    return settle(editing(state, null))
  }

  if (state.status === "editing" && state.dismissed?.start === token.start && state.dismissed.query === token.query) {
    return unchanged(state)
  }

  if (state.status !== "editing" && state.token.start === token.start && state.token.query === token.query) {
    return unchanged(state)
  }

  const attempt = state.attempt + 1
  const items = state.status !== "editing" && state.token.start === token.start ? state.items : []

  return {
    state: { status: "mention-loading", attempt, alternate: state.alternate, token, items, activeIndex: 0 },
    effects: [{ type: "mention.load", attempt, query: token.query }],
    handled: false,
  }
}

function submit(state: Live, config: LineCommentEditorConfig, alternate: boolean): LineCommentEditorTransition {
  const mode = alternate && config.alternateSubmit ? "alternate" : "primary"

  if (!canSubmit(config) || (mode === "alternate" && config.alternateSubmit?.disabled)) return handled(state)

  return {
    state: editing(state, null),
    effects: [{ type: "submit", mode, value: config.value.trim() }],
    handled: true,
  }
}

function cancel(state: Live, blur: boolean): LineCommentEditorTransition {
  return { state: editing(state, null), effects: [{ type: "cancel", blur }], handled: true }
}

function insert(state: Exclude<Live, { status: "editing" }>, index: number): LineCommentEditorTransition {
  const path = state.items[index]

  if (path === undefined) return unchanged(state)

  return { state: editing(state, null), effects: [{ type: "mention.insert", path, token: state.token }], handled: true }
}

function editing(state: Live, dismissed: MentionToken | null): LineCommentEditorState {
  return {
    status: "editing",
    attempt: state.attempt,
    alternate: state.alternate,
    dismissed: dismissed ? { start: dismissed.start, query: dismissed.query } : null,
  }
}

function withAlternate(state: Exclude<LineCommentEditorState, { status: "disposed" }>, alternate: boolean) {
  if (state.alternate === alternate) return unchanged(state)

  return settle({ ...state, alternate })
}

function navigation(key: LineCommentEditorKey) {
  if (!key.alt && !key.meta && key.key === "ArrowDown") return 1

  if (!key.alt && !key.meta && key.key === "ArrowUp") return -1

  if (!key.ctrl || key.meta || key.alt || key.shift) return 0

  if (key.key === "n") return 1

  if (key.key === "p") return -1

  return 0
}

function allowsAlternate(config: LineCommentEditorConfig) {
  return config.variant === "compact" && config.alternateSubmit !== null
}

function canSubmit(config: LineCommentEditorConfig) {
  return config.allowEmpty || config.value.trim().length > 0
}

function modifiedKey(key: LineCommentEditorKey) {
  return (key.meta || key.ctrl) && !key.alt && !key.shift
}

function unchanged(state: LineCommentEditorState): LineCommentEditorTransition {
  return { state, effects: NO_EFFECTS, handled: false }
}

function handled(state: LineCommentEditorState): LineCommentEditorTransition {
  return { state, effects: NO_EFFECTS, handled: true }
}

function settle(state: LineCommentEditorState, keyHandled = false): LineCommentEditorTransition {
  return { state, effects: NO_EFFECTS, handled: keyHandled }
}

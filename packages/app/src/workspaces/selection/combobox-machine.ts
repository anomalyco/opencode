import {
  cleanPickerInput,
  displayInputDirectory,
  displayPickerPath,
  nextSuggestionIndex,
  resolvePickerTarget,
  type PickerPolicy,
} from "./domain"

/** Bounded fallback so a hung search cannot keep suggestions loading forever. */
export const PICKER_SEARCH_TIMEOUT_MS = 10_000

export type PickerSuggestion = { readonly absolute: string; readonly type: "file" | "directory" }

/** What the input resolves and searches against. `fallback` is the base for relative input before a root opens. */
export type PickerComboboxContext = {
  readonly policy: PickerPolicy
  readonly home: string
  readonly root: string
  readonly fallback: string
  readonly locationDirectory: string | undefined
}

/**
 * The path input and its suggestion list. Only `open` holds items, and only for its `input`, so a key pressed while the
 * next search runs never acts on the previous query's results. `active` is null until the user steps or hovers;
 * `step` is an arrow key pressed while the search runs.
 */
export type PickerComboboxState =
  | { readonly status: "closed"; readonly attempt: number; readonly input: string }
  | { readonly status: "loading"; readonly attempt: number; readonly input: string; readonly step?: -1 | 1 }
  | {
      readonly status: "open"
      readonly attempt: number
      readonly input: string
      readonly items: readonly PickerSuggestion[]
      readonly active: number | null
    }
  | { readonly status: "disposed" }

export type PickerComboboxEvent =
  | { readonly type: "input.changed"; readonly value: string }
  | { readonly type: "cleared" }
  | { readonly type: "dismissed" }
  | { readonly type: "context.changed" }
  | { readonly type: "item.hovered"; readonly index: number }
  | { readonly type: "item.clicked"; readonly index: number }
  | { readonly type: "key.down"; readonly key: string; readonly shiftKey: boolean; readonly composing: boolean }
  | { readonly type: "search.resolved"; readonly attempt: number; readonly items: readonly PickerSuggestion[] }
  | { readonly type: "search.failed"; readonly attempt: number }
  | { readonly type: "search.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type PickerComboboxEffect =
  | { readonly type: "search.start"; readonly attempt: number; readonly query: string; readonly timeoutMs: number }
  | { readonly type: "search.cancel" }
  | { readonly type: "selection.clear" }
  | { readonly type: "choose.directory"; readonly path: string }
  | { readonly type: "choose.file"; readonly absolute: string }

export type PickerComboboxTransition = {
  readonly state: PickerComboboxState
  readonly effects: readonly PickerComboboxEffect[]
  readonly preventDefault: boolean
  readonly stopPropagation: boolean
}

type LiveCombobox = Exclude<PickerComboboxState, { status: "disposed" }>

type OpenCombobox = Extract<PickerComboboxState, { status: "open" }>

export function createPickerComboboxState(): PickerComboboxState {
  return { status: "closed", attempt: 0, input: "" }
}

export function transitionPickerCombobox(
  state: PickerComboboxState,
  event: PickerComboboxEvent,
  context: PickerComboboxContext,
): PickerComboboxTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return result({ status: "disposed" }, cancel(state))

  if (event.type === "input.changed") {
    const input = cleanPickerInput(event.value)

    // Trailing whitespace cleans to the same input; the running search or open list still matches it.
    if (input === state.input && (state.status !== "closed" || !input)) {
      return result(state, [{ type: "selection.clear" }])
    }

    return withInput(state, input, context, [{ type: "selection.clear" }])
  }

  if (event.type === "cleared") {
    if (state.status === "closed" && !state.input) return unchanged(state)

    return result({ status: "closed", attempt: state.attempt, input: "" }, cancel(state))
  }

  if (event.type === "dismissed") {
    if (state.status === "closed") return unchanged(state)

    return result(close(state, state.input), cancel(state))
  }

  if (event.type === "context.changed") {
    if (state.status === "closed") return unchanged(state)

    return withInput(state, state.input, context, [])
  }

  if (event.type === "search.resolved" || event.type === "search.failed" || event.type === "search.timed-out") {
    if (state.status !== "loading" || event.attempt !== state.attempt) return unchanged(state)
    const items = event.type === "search.resolved" ? event.items : []
    const open: OpenCombobox = { status: "open", attempt: state.attempt, input: state.input, items, active: null }
    const effects = event.type === "search.timed-out" ? cancel(state) : []

    return result(state.step && items.length > 0 ? step(open, state.step) : open, effects)
  }

  if (event.type === "item.hovered") {
    if (state.status !== "open" || state.active === event.index || !state.items[event.index]) return unchanged(state)

    return result({ ...state, active: event.index })
  }

  if (event.type === "item.clicked") {
    const item = state.status === "open" ? state.items[event.index] : undefined

    if (!item) return unchanged(state)

    return choose(state, item, context)
  }

  return key(state, event, context)
}

export function effectiveActiveIndex(state: PickerComboboxState) {
  if (state.status !== "open" || state.items.length === 0) return -1

  if (state.active !== null) return state.active

  // Input that names a folder ("~", "~/", "/", "src/", "C:\\Users\\") submits that folder unless the user steps.
  return state.input === "~" || /[\\/]$/.test(state.input) ? -1 : 0
}

// Input equal to the open root has nothing to suggest, and searches need a server location.
export function canSearchPickerInput(input: string, context: PickerComboboxContext) {
  if (!input || !context.locationDirectory) return false

  if (!context.root) return true

  return input.replace(/\/+$/, "") !== displayPickerPath(context.root, input, context.home).replace(/\/+$/, "")
}

export function pickerComboboxView(state: PickerComboboxState) {
  const items = state.status === "open" ? state.items : []
  const active = effectiveActiveIndex(state)

  return {
    input: state.status === "disposed" ? "" : state.input,
    items,
    listboxOpen: items.length > 0,
    active,
    activeDescendant: active >= 0 ? `directory-picker-suggestion-${active}` : undefined,
  }
}

function key(
  state: LiveCombobox,
  event: Extract<PickerComboboxEvent, { type: "key.down" }>,
  context: PickerComboboxContext,
): PickerComboboxTransition {
  const items = state.status === "open" ? state.items : []

  if (event.key === "Escape") {
    if (state.status !== "open" || items.length === 0) return unchanged(state)

    return { ...result(close(state, state.input)), preventDefault: true, stopPropagation: true }
  }

  if (event.key === "Tab") {
    if (event.shiftKey || state.status !== "open" || items.length === 0) return unchanged(state)
    const match = items[state.active ?? 0] ?? items[0]!

    if (match.type === "file") return handled(choose(state, match, context))
    const value = displayPickerPath(match.absolute, state.input, context.home)

    return handled(withInput(state, value.endsWith("/") ? value : value + "/", context, []))
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const delta = event.key === "ArrowDown" ? 1 : -1

    if (state.status === "open") return items.length > 0 ? handled(result(step(state, delta))) : unchanged(state)

    if (state.status === "loading") return handled(result({ ...state, step: delta }))

    if (!canSearchPickerInput(state.input, context)) return unchanged(state)
    const searching = withInput(state, state.input, context, [])

    return handled(
      searching.state.status === "loading" ? { ...searching, state: { ...searching.state, step: delta } } : searching,
    )
  }

  if (event.key !== "Enter" || event.composing) return unchanged(state)
  const active = effectiveActiveIndex(state)

  if (state.status === "open" && active >= 0) return handled(choose(state, state.items[active]!, context))
  const value = state.input ? resolve(state.input, context) : undefined

  if (!value) return handled(unchanged(state))

  return handled(
    result(close(state, displayInputDirectory(value, context.home)), [
      ...cancel(state),
      { type: "choose.directory", path: state.input },
    ]),
  )
}

function choose(state: LiveCombobox, item: PickerSuggestion, context: PickerComboboxContext) {
  if (item.type === "file") {
    return result(close(state, displayPickerPath(item.absolute, state.input, context.home)), [
      ...cancel(state),
      { type: "choose.file", absolute: item.absolute },
    ])
  }

  const value = resolve(item.absolute, context)

  if (!value) return unchanged(state)

  return result(close(state, displayInputDirectory(value, context.home)), [
    ...cancel(state),
    { type: "choose.directory", path: item.absolute },
  ])
}

function withInput(
  state: LiveCombobox,
  input: string,
  context: PickerComboboxContext,
  effects: readonly PickerComboboxEffect[],
): PickerComboboxTransition {
  if (!input) return result(close(state, ""), [...cancel(state), ...effects])

  if (!canSearchPickerInput(input, context)) {
    return result({ status: "open", attempt: state.attempt, input, items: [], active: null }, [
      ...cancel(state),
      ...effects,
    ])
  }

  const attempt = state.attempt + 1

  return result({ status: "loading", attempt, input }, [
    ...effects,
    { type: "search.start", attempt, query: input, timeoutMs: PICKER_SEARCH_TIMEOUT_MS },
  ])
}

function step(state: OpenCombobox, delta: -1 | 1): OpenCombobox {
  return { ...state, active: nextSuggestionIndex(effectiveActiveIndex(state), delta, state.items.length) }
}

function resolve(path: string, context: PickerComboboxContext) {
  return resolvePickerTarget(context.policy, path, context.home, context.root || context.fallback)
}

function close(state: LiveCombobox, input: string): PickerComboboxState {
  return { status: "closed", attempt: state.attempt, input }
}

function cancel(state: PickerComboboxState): PickerComboboxEffect[] {
  return state.status === "loading" ? [{ type: "search.cancel" }] : []
}

function handled(transition: PickerComboboxTransition): PickerComboboxTransition {
  return { ...transition, preventDefault: true }
}

function result(state: PickerComboboxState, effects: readonly PickerComboboxEffect[] = []): PickerComboboxTransition {
  return { state, effects, preventDefault: false, stopPropagation: false }
}

function unchanged(state: PickerComboboxState): PickerComboboxTransition {
  return result(state)
}

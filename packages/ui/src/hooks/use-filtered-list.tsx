import { batch, createComputed, createMemo, createReaction, createSignal, on, onCleanup, untrack } from "solid-js"
import {
  createListState,
  LIST_LOAD_TIMEOUT_MS,
  selectListFailed,
  selectListLoading,
  transitionList,
  type ListEvent,
  type ListGroup,
} from "./list-machine"

export { groupItems } from "./list-machine"

export interface FilteredListProps<T> {
  items: T[] | ((filter: string) => T[] | Promise<T[]>)
  key: (item: T) => string
  filterKeys?: string[]
  current?: T
  groupBy?: (x: T) => string
  sortBy?: (a: T, b: T) => number
  sortGroupsBy?: (a: ListGroup<T>, b: ListGroup<T>) => number
  skipFilter?: (item: T) => boolean
  onSelect?: (value: T | undefined, index: number) => void
  /** Makes the query parent-owned: the list shows this value and reports edits through `onFilter`. */
  filter?: string
  onFilter?: (value: string) => void
}

export function useFilteredList<T>(props: FilteredListProps<T>) {
  const [state, setState] = createSignal(createListState<T>(props.filter))
  let loadTimer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: ListEvent<T>, keyboard?: KeyboardEvent) => {
    const result = transitionList(untrack(state), event, props)

    if (result.handled) keyboard?.preventDefault()

    // A synchronous load settles inside the batch, so readers never see its `loading` step.
    batch(() => {
      setState(() => result.state)
      result.effects.forEach((effect) => {
        if (effect.type === "cancel.load") clearTimeout(loadTimer)

        if (effect.type === "load") load(effect.attempt, effect.query)
      })
    })
    result.effects.forEach((effect) => {
      if (effect.type === "notify.filter") props.onFilter?.(effect.value)

      if (effect.type === "select") props.onSelect?.(effect.item, effect.index)
    })
  }

  // Tracks what the last load read (`props.items`, or the signals `items(query)` reads) and reloads when it changes.
  const track = createReaction(() => dispatch({ type: "items.reload" }))

  const load = (attempt: number, query: string) => {
    // A new attempt supersedes the previous one, whose timeout would otherwise fail it after it was replaced.
    clearTimeout(loadTimer)
    track(() => {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- `items` is either a list or a loader for one
      const items = typeof props.items === "function" ? props.items(query) : props.items
      untrack(() => settle(attempt, items))
    })
  }

  const settle = (attempt: number, items: T[] | Promise<T[]>) => {
    if (Array.isArray(items)) return dispatch({ type: "load.resolved", attempt, items })

    loadTimer = setTimeout(() => dispatch({ type: "load.timed-out", attempt }), LIST_LOAD_TIMEOUT_MS)
    void items.then(
      (items) => dispatch({ type: "load.resolved", attempt, items: items ?? [] }),
      () => dispatch({ type: "load.failed", attempt }),
    )
  }

  createComputed(
    on(
      () => props.filter,
      (value) => dispatch(value === undefined ? { type: "filter.uncontrolled" } : { type: "filter.controlled", value }),
      { defer: true },
    ),
  )

  onCleanup(() => dispatch({ type: "disposed" }))

  dispatch({ type: "items.reload" })

  const groups = createMemo(() => state().groups)
  const loading = createMemo(() => selectListLoading(state()))
  const failed = createMemo(() => selectListFailed(state()))

  return {
    state,
    dispatch,
    grouped: {
      get latest() {
        return groups()
      },
      get loading() {
        return loading()
      },
      get state(): "ready" | "refreshing" | "errored" {
        if (loading()) return "refreshing"

        return failed() ? "errored" : "ready"
      },
    },
    filter: createMemo(() => state().filter.query),
    flat: createMemo(() => state().rows),
    active: createMemo(() => state().highlight.activeKey),
    reset: () => dispatch({ type: "active.reset" }),
    refetch: () => dispatch({ type: "items.reload" }),
    clear: () => dispatch({ type: "query.change", value: "" }),
    onInput: (value: string) => dispatch({ type: "query.change", value }),
    setActive: (key: string | null) => dispatch({ type: "active.set", key }),
    onKeyDown: (event: KeyboardEvent, options?: { search?: boolean; claimed?: boolean }) =>
      dispatch(
        {
          type: "key.down",
          key: event.key,
          ctrl: event.ctrlKey,
          alt: event.altKey,
          meta: event.metaKey,
          shift: event.shiftKey,
          composing: event.isComposing,
          search: options?.search === true,
          claimed: options?.claimed === true,
        },
        event,
      ),
  }
}

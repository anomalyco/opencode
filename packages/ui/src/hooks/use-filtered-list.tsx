import fuzzysort from "fuzzysort"
import { entries, flatMap, groupBy, map, pipe } from "remeda"
import { createEffect, createMemo, createResource, on } from "solid-js"
import { createStore } from "solid-js/store"
import { createList } from "solid-list"

export interface FilteredListProps<T> {
  items: T[] | ((filter: string) => T[] | Promise<T[]>)
  key: (item: T) => string
  filterKeys?: string[]
  current?: T
  groupBy?: (x: T) => string
  sortBy?: (a: T, b: T) => number
  sortGroupsBy?: (a: { category: string; items: T[] }, b: { category: string; items: T[] }) => number
  onSelect?: (value: T | undefined, index: number) => void
}

export function useFilteredList<T>(props: FilteredListProps<T>) {
  const [store, setStore] = createStore<{ filter: string }>({ filter: "" })

  type Group = { category: string; items: [T, ...T[]] }
  const empty: Group[] = []

  const [grouped, { refetch }] = createResource(
    () => {
      // When items is a function that takes arguments (filter function), don't call it in the source.
      // Only call synchronous functions with no arguments to track reactive changes.
      const isFilterFunction = typeof props.items === "function" && props.items.length > 0
      const itemsValue =
        typeof props.items === "function" && !isFilterFunction
          ? (props.items as () => T[])() // Call synchronous function to track it
          : props.items

      return {
        filter: store.filter,
        items: isFilterFunction ? undefined : itemsValue,
        isFilterFunction,
      }
    },
    async ({ filter, items, isFilterFunction }) => {
      const needle = filter?.toLowerCase()
      const all: T[] = (isFilterFunction || items === undefined
        ? await (props.items as (filter: string) => T[] | Promise<T[]>)(needle ?? "")
        : items as T[]) || []
      const filtered: T[] = (() => {
        if (!needle) return all
        if (!props.filterKeys && all.every((e) => typeof e === "string")) {
          return fuzzysort.go(needle, all as unknown as string[]).map((x) => x.target) as T[]
        }
        return fuzzysort.go(needle, all, { keys: props.filterKeys! }).map((x) => x.obj as T)
      })()
      const result = pipe(
        filtered,
        groupBy((x: T) => (props.groupBy ? props.groupBy(x) : "")),
        entries(),
        map(([k, v]) => ({ category: k, items: props.sortBy ? v.sort(props.sortBy) : v })),
        (groups) => (props.sortGroupsBy ? groups.sort(props.sortGroupsBy) : groups),
      )
      return result
    },
    { initialValue: empty },
  )

  const flat = createMemo(() => {
    return pipe(
      grouped.latest || [],
      flatMap((x: Group) => x.items),
    )
  })

  function initialActive() {
    if (props.current) return props.key(props.current)

    const items = flat()
    if (items.length === 0) return ""
    return props.key(items[0])
  }

  const list = createList({
    items: () => flat().map(props.key),
    initialActive: initialActive(),
    loop: true,
  })

  const reset = () => {
    const all = flat()
    if (all.length === 0) return
    list.setActive(props.key(all[0]))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault()
      const selectedIndex = flat().findIndex((x) => props.key(x) === list.active())
      const selected = flat()[selectedIndex]
      if (selected) props.onSelect?.(selected, selectedIndex)
    } else {
      // Skip list navigation for text editing shortcuts (e.g., Option+Arrow, Option+Backspace on macOS)
      if (event.altKey || event.metaKey) return
      list.onKeyDown(event)
    }
  }

  createEffect(
    on(grouped, () => {
      reset()
    }),
  )

  const onInput = (value: string) => {
    setStore("filter", value)
  }

  return {
    grouped,
    filter: () => store.filter,
    flat,
    reset,
    refetch,
    clear: () => setStore("filter", ""),
    onKeyDown,
    onInput,
    active: list.active,
    setActive: list.setActive,
  }
}

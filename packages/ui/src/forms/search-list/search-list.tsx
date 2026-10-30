import {
  createContext,
  createEffect,
  createMemo,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  useContext,
} from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Icon } from "@opencode/ui/icon"
import { TextInput } from "../text-input/text-input"
import { createTypeahead } from "../typeahead/controller"
import { searchListMove, searchListTarget } from "./navigation"
import "./search-list.css"

/** Attributes for a row's element: spread them, then override a handler to change what the pointer does. */
export type SearchListRow = {
  id: string
  role: "option"
  "aria-selected": boolean
  "data-slot": "search-list-row"
  "data-active": "" | undefined
  onMouseMove: (event: MouseEvent) => void
  onMouseDown: (event: MouseEvent) => void
  onClick: () => void
}

/** Attributes for the input of a field passed as `field`: spread them onto it. */
export type SearchListField = {
  role: "combobox"
  "aria-expanded": boolean
  "aria-autocomplete": "list"
  "aria-controls": string | undefined
  "aria-activedescendant": string | undefined
  onInput: (event: InputEvent & { currentTarget: HTMLInputElement }) => void
  onKeyDown: (event: KeyboardEvent) => void
}

export type SearchListHandle<T> = {
  active: () => T | undefined
  setActive: (key: string | undefined) => void
}

const QueryContext = createContext<() => string>(() => "")

/**
 * A search field over sectioned results. Rows that share a `section` key list together under one header, which sticks
 * while its rows scroll beneath it until the next header pushes it away. The first row is active until the user picks
 * another: ↑/↓ wrap, ⌘ or ⌥ with ↑/↓ jump between sections, Home/End go to the ends, Enter selects and Escape closes.
 * A page can keep its own field through `field` and float the results beneath it with `popover`.
 */
export function SearchList<T>(props: {
  query: string
  onQuery: (query: string) => void
  placeholder: string
  /** The results' accessible name; the placeholder by default. */
  label?: string
  /** Controls after the field, such as icon buttons. */
  trailing?: JSX.Element
  /** A search field of the page's own in place of the built-in one. */
  field?: (field: SearchListField) => JSX.Element
  /** Whether the results show. Closed, only the field remains and the list leaves keys to the page. On by default. */
  open?: boolean
  /** Float the results beneath the field on a raised surface, over what follows it. */
  popover?: boolean
  items: T[]
  key: (item: T) => string
  section?: (item: T) => string
  /** Rows that show the same thing in two sections. ↑/↓ step past a copy, so the highlight always lands somewhere new. */
  same?: (a: T, b: T) => boolean
  /** A section's header, from its first row. */
  header?: (item: T) => JSX.Element
  /** Shown in place of the rows when there are none. */
  empty: JSX.Element
  /** A note beneath the rows, such as a hint that more results are hidden. */
  footer?: JSX.Element
  /** Where the results start scrolled each time they mount, such as a position kept from an earlier visit. */
  scrollTop?: number
  onScroll?: (scrollTop: number) => void
  onSelect: (item: T) => void
  onActive?: (item: T | undefined) => void
  /** Runs before the list's own keys; call `preventDefault` to claim one. */
  onKeyDown?: (event: KeyboardEvent, active: T | undefined) => void
  onClose?: () => void
  ref?: (handle: SearchListHandle<T>) => void
  class?: string
  /** A row. `item` stays current while results with the same key replace it, so the row keeps its element. */
  children: (item: () => T, row: SearchListRow) => JSX.Element
}) {
  let viewport: HTMLDivElement | undefined
  let results: HTMLDivElement | undefined

  const sectionOf = (item: T) => props.section?.(item) ?? ""
  const open = () => props.open ?? true

  // Sections in the order their first row arrives; rows then list section by section, which is also the arrow order.
  const groups = createMemo(() => {
    const all = new Map<string, T[]>()

    props.items.forEach((item) => {
      const list = all.get(sectionOf(item))

      if (list) list.push(item)
      else all.set(sectionOf(item), [item])
    })

    return all
  })

  const rows = createMemo(() => [...groups().values()].flat())
  const byKey = createMemo(() => new Map(rows().map((item) => [props.key(item), item] as const)))
  const sectionKeys = createMemo<string[]>((previous) => stable(previous, [...groups().keys()]))

  const typeahead = createTypeahead<T>({
    items: rows,
    key: (item) => props.key(item),
    onSelect: (item) => props.onSelect(item),
    onClose: props.onClose && (() => props.onClose?.()),
  })

  const activeKey = createMemo(() => {
    const item = typeahead.activeItem()

    return item === undefined ? undefined : props.key(item)
  })

  // The first row shows from the top, so its header is never hidden; any other row scrolls in only as far as needed.
  const reveal = () => {
    const item = typeahead.activeItem()

    if (!viewport) return

    if (item === undefined || item === rows()[0]) return viewport.scrollTo({ top: 0 })
    document.getElementById(typeahead.optionID(item))?.scrollIntoView({ block: "nearest" })
  }

  // Rows fade out where they run under the top header or past the bottom edge. Each fade reaches full strength once
  // 15 px is hidden, so it eases in with the scroll. The top fade follows the header over the topmost section and
  // measures what that section has hidden, so a header that pushes the last one away starts clear again. Sections are
  // measured when the list lays out, so scrolling only does arithmetic.
  let sections: { top: number; bottom: number; header: number }[] = []

  const edges = () => {
    if (!viewport) return
    const scroll = viewport.scrollTop
    const strength = (hidden: number) => String(Math.min(1, Math.max(0, hidden / 15)))
    const current = sections.findLast((section) => section.top - scroll < section.header)

    // A stuck header sits at the top until its section's end pushes it up.
    const offset = current?.header
      ? Math.min(Math.max(current.top - scroll, 0) + current.header, current.bottom - scroll)
      : 0

    viewport.style.setProperty("--search-list-fade-offset", `${Math.max(0, offset)}px`)
    viewport.style.setProperty("--search-list-fade-top", strength(current ? scroll - current.top : 0))
    viewport.style.setProperty(
      "--search-list-fade-bottom",
      strength(viewport.scrollHeight - viewport.clientHeight - scroll),
    )
  }

  const measure = () => {
    if (!viewport) return
    const origin = viewport.getBoundingClientRect().top - viewport.scrollTop

    sections = [...viewport.querySelectorAll<HTMLElement>('[data-slot="search-list-section"]')].map((section) => {
      const rect = section.getBoundingClientRect()

      // A sticky header stays inside its section's content box, so the section's bottom padding is out of its reach.
      return {
        top: rect.top - origin,
        bottom: rect.bottom - origin - parseFloat(getComputedStyle(section).paddingBottom),
        header: section.querySelector<HTMLElement>('[data-slot="search-list-header"]')?.offsetHeight ?? 0,
      }
    })
    edges()
  }

  createResizeObserver(() => [viewport, results], measure)
  createEffect(on(rows, measure, { defer: true }))

  createEffect(() => props.onActive?.(typeahead.activeItem()))

  // A new query starts from the top. Results that arrive later for the same query bring a chosen row back into view,
  // but leave the list where the wheel put it while the first row is still the default.
  let revealed = props.query

  createEffect(
    on(
      rows,
      (all) => {
        const fresh = props.query !== revealed
        revealed = props.query

        if (!fresh && typeahead.activeItem() === all[0]) return
        const frame = requestAnimationFrame(reveal)
        onCleanup(() => cancelAnimationFrame(frame))
      },
      { defer: true },
    ),
  )

  props.ref?.({ active: typeahead.activeItem, setActive: typeahead.setActive })

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return
    props.onKeyDown?.(event, typeahead.activeItem())

    if (event.defaultPrevented || !open()) return
    const move = searchListMove(event)

    if (!move) return typeahead.onKeyDown(event)
    event.preventDefault()
    event.stopPropagation()
    const all = rows()
    const sections = all.map(sectionOf)
    const active = typeahead.activeItem()
    const from = active === undefined ? -1 : all.indexOf(active)

    const step = (index: number): number => {
      const next = searchListTarget(sections, index, move)
      const copy = (move === "next" || move === "previous") && active !== undefined && next !== from

      return copy && props.same?.(all[next]!, active) ? step(next) : next
    }

    const target = all[step(from)]

    if (target === undefined) return
    typeahead.setActive(props.key(target))
    reveal()
  }

  onMount(() => {
    if (viewport && props.scrollTop) viewport.scrollTop = props.scrollTop
  })

  const field: SearchListField = {
    role: "combobox",
    get "aria-expanded"() {
      return open()
    },
    "aria-autocomplete": "list",
    get "aria-controls"() {
      return open() ? typeahead.listID : undefined
    },
    get "aria-activedescendant"() {
      return open() ? typeahead.activeID() : undefined
    },
    onInput: (event) => {
      // A new query starts again from its first row.
      typeahead.setActive(undefined)
      props.onQuery(event.currentTarget.value)
    },
    onKeyDown,
  }

  const row = (key: string, item: () => T): SearchListRow => ({
    get id() {
      return typeahead.optionID(item())
    },
    role: "option",
    get "aria-selected"() {
      return activeKey() === key
    },
    "data-slot": "search-list-row",
    get "data-active"() {
      return activeKey() === key ? ("" as const) : undefined
    },
    onMouseMove: (event) => {
      // A static cursor must not take the active row while the keyboard scrolls rows beneath it.
      if (event.movementX !== 0 || event.movementY !== 0) typeahead.setActive(key)
    },
    // Focus stays in the field.
    onMouseDown: (event) => event.preventDefault(),
    onClick: () => props.onSelect(item()),
  })

  return (
    <QueryContext.Provider value={() => props.query}>
      <div data-component="search-list" data-popover={props.popover ? "" : undefined} class={props.class}>
        <Show
          when={props.field}
          fallback={
            <div data-slot="search-list-search">
              <TextInput
                {...field}
                value={props.query}
                autofocus
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                spellcheck={false}
                appearance="large"
                placeholder={props.placeholder}
                aria-label={props.placeholder}
                leadingIcon={<Icon name="magnifying-glass" />}
                trailing={props.trailing}
              />
            </div>
          }
        >
          {(custom) => custom()(field)}
        </Show>
        <div data-slot="search-list-body" hidden={!open()}>
          <div
            data-slot="search-list-scroll"
            data-scrollable
            ref={(element) => (viewport = element)}
            onScroll={(event) => {
              edges()
              props.onScroll?.(event.currentTarget.scrollTop)
            }}
          >
            <div data-slot="search-list-fade" aria-hidden="true" />
            <div
              ref={results}
              id={typeahead.listID}
              data-slot="search-list-results"
              role="listbox"
              hidden={rows().length === 0}
              aria-label={props.label ?? props.placeholder}
            >
              <For each={sectionKeys()}>
                {(section) => {
                  const keys = createMemo<string[]>((previous) =>
                    stable(previous, (groups().get(section) ?? []).map(props.key)),
                  )

                  const first = () => byKey().get(keys()[0] ?? "")

                  const header = createMemo(() =>
                    props.header && first() !== undefined ? props.header(first()!) : undefined,
                  )

                  const id = `${typeahead.listID}-section-${encodeURIComponent(section)}`

                  return (
                    <div data-slot="search-list-section" role="group" aria-labelledby={header() ? id : undefined}>
                      <Show when={header()}>
                        {(content) => (
                          <div id={id} data-slot="search-list-header">
                            {content()}
                          </div>
                        )}
                      </Show>
                      <For each={keys()}>
                        {(key) => {
                          // A row that is leaving keeps its last item until it is removed.
                          const item = createMemo<T>((previous) => byKey().get(key) ?? previous, byKey().get(key)!)

                          return props.children(item, row(key, item))
                        }}
                      </For>
                    </div>
                  )
                }}
              </For>
            </div>
            <Show when={rows().length === 0}>
              <div data-slot="search-list-empty">{props.empty}</div>
            </Show>
          </div>
          <Show when={props.footer}>
            <div data-slot="search-list-footer">{props.footer}</div>
          </Show>
        </div>
      </div>
    </QueryContext.Provider>
  )
}

/** Text with its first match for the list's query marked. One mark per row keeps short queries from speckling the list. */
export function SearchHighlight(props: { text: string }) {
  const query = useContext(QueryContext)

  const match = createMemo(() => {
    const needle = query().trim().toLowerCase()
    const haystack = props.text.toLowerCase()
    const at = needle ? haystack.indexOf(needle) : -1

    // Lower-casing a few scripts changes the length, and then offsets no longer line up with the text.
    if (at === -1 || haystack.length !== props.text.length) return

    return { at, end: at + needle.length }
  })

  return (
    <Show when={match()} fallback={props.text}>
      {(range) => (
        <>
          {props.text.slice(0, range().at)}
          <mark data-slot="search-list-match">{props.text.slice(range().at, range().end)}</mark>
          {props.text.slice(range().end)}
        </>
      )}
    </Show>
  )
}

function stable(previous: string[] | undefined, next: string[]) {
  return previous && previous.length === next.length && previous.every((value, index) => value === next[index])
    ? previous
    : next
}

import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createEffect, createMemo, For, type JSX, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { abort } from "@opencode/util/abort"
import { useI18n } from "../../context/i18n"
import { Loader } from "../../feedback/loader/loader"
import { ScrollView } from "../../components/scroll-view"
import { createTypeahead } from "./controller"

export { createTypeahead } from "./controller"

/** A search field over results from `source` that keeps rows on screen while a query is pending. */
export function Typeahead<T>(props: {
  source: (query: string, signal: AbortSignal) => Promise<T[]>
  /** Narrows earlier results while the request for the current query is pending. */
  match: (item: T, query: string) => boolean
  key: (item: T) => string
  /** Milliseconds a typed query waits before it reaches the source. */
  delay: number
  placeholder: string
  emptyLabel: string
  retryLabel: string
  /** Key of the current value. */
  selected?: string
  onSelect: (item: T) => void
  children: (item: T) => JSX.Element
}) {
  const i18n = useI18n()

  const [store, setStore] = createStore<{ query: string; answered?: string; failed?: boolean; loading?: boolean }>({
    query: "",
  })

  const cache = new Map<string, T[]>()
  let seen: T[] = []
  let request: AbortController | undefined
  let input: HTMLInputElement | undefined
  onCleanup(() => abort(request))

  const query = () => store.query.trim()
  const pending = () => store.loading || store.answered !== query()

  const search = (query: string) => {
    abort(request)

    if (cache.has(query)) return setStore({ answered: query, failed: false, loading: false })
    const current = (request = new AbortController())
    setStore("loading", true)
    props.source(query, current.signal).then(
      (items) => {
        if (current.signal.aborted) return
        const keys = new Set(items.map(props.key))
        cache.set(query, items)
        seen = [...items, ...seen.filter((item) => !keys.has(props.key(item)))].slice(0, 500)
        setStore({ answered: query, failed: false, loading: false })
      },
      () => !current.signal.aborted && setStore({ answered: query, failed: true, loading: false }),
    )
  }

  // A cached or empty query answers at once; a typed one waits, and the request it supersedes is aborted.
  createEffect(() => {
    const next = query()

    if (!next || cache.has(next)) return search(next)
    abort(request)
    const timer = setTimeout(() => search(next), props.delay)
    onCleanup(() => clearTimeout(timer))
  })

  // While a query is pending: its cached answer, else earlier rows that match it, else the rows on screen, marked stale.
  const results = createMemo<{ items: T[]; stale: boolean }>((previous) => {
    const next = query()

    if (store.answered === next && store.failed) return { items: [], stale: false }
    const cached = cache.get(next) ?? seen.filter((item) => props.match(item, next))

    if (cache.has(next) || cached.length > 0) return { items: cached, stale: false }

    return { items: previous?.items ?? [], stale: !!previous?.items.length }
  })

  const typeahead = createTypeahead<T>({
    items: () => results().items,
    key: (item) => props.key(item),
    stale: () => results().stale,
    onSelect: (item) => props.onSelect(item),
  })

  createEffect(() => {
    const id = typeahead.activeID()

    if (id) document.getElementById(id)?.scrollIntoView({ block: "nearest" })
  })

  return (
    <div class="flex min-w-0 flex-col text-[13px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-base">
      <div class="flex h-8 shrink-0 items-center gap-2 ps-3 pe-2">
        {/* The loader shares the glyph's slot and fades in only for requests slower than 150 ms. */}
        <span
          data-pending={pending() ? "" : undefined}
          aria-hidden="true"
          class="group grid size-3.5 shrink-0 place-items-center text-v2-icon-icon-muted *:[grid-area:1/1] *:transition-opacity *:duration-150 data-[pending]:*:delay-150"
        >
          <Icon name="magnifying-glass" size="small" class="group-data-[pending]:opacity-0" />
          <Loader class="size-3 opacity-0 group-data-[pending]:opacity-100" />
        </span>
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={typeahead.listID}
          aria-autocomplete="list"
          aria-busy={pending()}
          aria-activedescendant={typeahead.activeID()}
          aria-label={props.placeholder}
          placeholder={props.placeholder}
          value={store.query}
          autocomplete="off"
          spellcheck={false}
          class="h-8 min-w-0 flex-1 outline-none placeholder:text-v2-text-text-faint"
          onInput={(event) => setStore("query", event.currentTarget.value)}
          onKeyDown={typeahead.onKeyDown}
        />
        <Show when={store.query}>
          <button
            type="button"
            aria-label={i18n.t("ui.list.clearFilter")}
            class="flex size-5 shrink-0 items-center justify-center rounded-sm text-v2-icon-icon-faint outline-none hover:text-v2-icon-icon-base focus-visible:text-v2-icon-icon-base"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              setStore("query", "")
              input?.focus()
            }}
          >
            <Icon name="circle-xmark" size="small" />
          </button>
        </Show>
      </div>
      {/* Height follows the results on a critically damped spring (0.3 s, bounce 0); the first measurement snaps. */}
      <div class="overflow-hidden transition-[height] duration-[350ms] ease-[linear(0,0.097,0.282,0.466,0.619,0.736,0.821,0.881,0.921,0.949,0.967,0.979,0.986,0.991,1)] motion-reduce:transition-none">
        <div
          ref={(element) =>
            createResizeObserver(element, (rect) =>
              element.parentElement?.style.setProperty("height", `${rect.height}px`),
            )
          }
        >
          <ScrollView focusable={false} class="max-h-56">
            <div id={typeahead.listID} role="listbox" class="px-1 pb-1 empty:hidden">
              <For each={results().items}>
                {(item) => (
                  <div
                    id={typeahead.optionID(item)}
                    role="option"
                    aria-selected={typeahead.activeItem() === item}
                    aria-current={props.selected === props.key(item) ? "true" : undefined}
                    class="flex h-7 min-w-0 cursor-default select-none items-center gap-2 rounded-sm px-2 transition-opacity duration-150 aria-selected:bg-v2-overlay-simple-overlay-hover"
                    classList={{ "opacity-50": results().stale }}
                    onMouseMove={(event) => {
                      // A static cursor must not steal the active row while the keyboard scrolls the list.
                      if (event.movementX !== 0 || event.movementY !== 0) typeahead.setActive(props.key(item))
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => props.onSelect(item)}
                  >
                    {props.children(item)}
                    <Show when={props.selected === props.key(item)}>
                      <Icon name="check" size="small" class="ms-auto shrink-0 text-v2-icon-icon-muted" />
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </ScrollView>
          {/* Stays mounted while a retry or a newer query is pending, so the list never collapses to nothing. */}
          <Show when={results().items.length === 0}>
            <div
              class="mx-1 mb-1 flex h-7 items-center px-2 text-v2-text-text-faint"
              classList={{ invisible: store.answered === undefined }}
            >
              <Show when={store.failed} fallback={props.emptyLabel}>
                <button
                  type="button"
                  class="-mx-2 flex h-7 flex-1 items-center rounded-sm px-2 text-start text-v2-text-text-base outline-none hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => search(query())}
                >
                  {props.retryLabel}
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}

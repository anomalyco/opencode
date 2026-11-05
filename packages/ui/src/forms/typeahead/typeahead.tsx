import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createEffect, createSignal, For, type JSX, on, onCleanup, Show, untrack } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { abort } from "@opencode/util/abort"
import { useI18n } from "../../context/i18n"
import { Loader } from "../../feedback/loader/loader"
import { MenuScroll } from "../../components/menu-scroll"
import { createTypeahead } from "./controller"
import {
  createTypeaheadState,
  selectTypeaheadAnimateHeight,
  selectTypeaheadAnswered,
  selectTypeaheadFailed,
  selectTypeaheadInput,
  selectTypeaheadItems,
  selectTypeaheadPending,
  selectTypeaheadStale,
  transitionTypeahead,
  TYPEAHEAD_REQUEST_TIMEOUT_MS,
  type TypeaheadEffect,
  type TypeaheadEvent,
} from "./machine"

export { createTypeahead } from "./controller"

/** A search field over results from `source` that keeps rows on screen while a query is pending. */
export function Typeahead<T>(props: {
  source: (query: string, signal: AbortSignal) => Promise<T[]>
  /** Preloaded opening results, including a failed request that the user can retry. */
  initial?: { items: T[]; failed?: boolean }
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
  const created = createTypeaheadState(props.initial)
  const [machine, setMachine] = createSignal(created.state)
  let timer: ReturnType<typeof setTimeout> | undefined
  let request: AbortController | undefined
  let input: HTMLInputElement | undefined

  const dispatch = (event: TypeaheadEvent<T>) => {
    const prev = untrack(machine)
    const next = transitionTypeahead(prev, event)

    if (next.state !== prev) setMachine(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: TypeaheadEffect) => {
    clearTimeout(timer)
    timer = undefined
    abort(request)
    request = undefined

    if (effect.type === "cancel") return
    const attempt = effect.attempt

    if (effect.type === "debounce") {
      timer = setTimeout(() => dispatch({ type: "debounce.elapsed", attempt }), effect.delayMs)

      return
    }

    const current = (request = new AbortController())
    // A source that ignores the signal or stalls must still end in a state the user can retry from.
    timer = setTimeout(() => dispatch({ type: "request.timed-out", attempt }), TYPEAHEAD_REQUEST_TIMEOUT_MS)
    props.source(effect.query, current.signal).then(
      (items) => {
        if (!current.signal.aborted) dispatch({ type: "request.succeeded", attempt, items })
      },
      () => {
        if (!current.signal.aborted) dispatch({ type: "request.failed", attempt })
      },
    )
  }

  created.effects.forEach(run)

  createEffect(
    on(
      () => props.initial,
      (initial) => dispatch({ type: "initial.synced", initial }),
      { defer: true },
    ),
  )

  onCleanup(() => dispatch({ type: "disposed" }))

  const changeInput = (value: string) =>
    dispatch({ type: "input.changed", input: value, delayMs: props.delay, match: props.match })

  const items = () => selectTypeaheadItems(machine())
  const stale = () => selectTypeaheadStale(machine())
  const pending = () => selectTypeaheadPending(machine())
  const animateHeight = () => selectTypeaheadAnimateHeight(machine())

  const typeahead = createTypeahead<T>({
    items,
    key: (item) => props.key(item),
    stale,
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
          value={selectTypeaheadInput(machine())}
          autocomplete="off"
          spellcheck={false}
          class="h-8 min-w-0 flex-1 outline-none placeholder:text-v2-text-text-faint"
          onInput={(event) => changeInput(event.currentTarget.value)}
          onKeyDown={typeahead.onKeyDown}
        />
        <Show when={selectTypeaheadInput(machine())}>
          <button
            type="button"
            aria-label={i18n.t("ui.list.clearFilter")}
            class="flex size-5 shrink-0 items-center justify-center rounded-sm text-v2-icon-icon-faint outline-none hover:text-v2-icon-icon-base focus-visible:text-v2-icon-icon-base"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              changeInput("")
              input?.focus()
            }}
          >
            <Icon name="circle-xmark" size="small" />
          </button>
        </Show>
      </div>
      <div aria-hidden="true" class="h-[0.5px] shrink-0 bg-v2-border-border-base" />
      {/* Initial results and the empty state snap into place; other search resizing animates. */}
      <div
        class="overflow-hidden duration-[200ms] ease-[cubic-bezier(0.645,0.045,0.355,1)] motion-reduce:transition-none"
        classList={{ "transition-[height]": animateHeight(), "transition-none": !animateHeight() }}
      >
        <div
          ref={(element) =>
            createResizeObserver(element, (rect) =>
              element.parentElement?.style.setProperty("height", `${rect.height}px`),
            )
          }
        >
          <MenuScroll
            id={typeahead.listID}
            role="listbox"
            class="max-h-56"
            viewportClass="p-1"
            classList={{ hidden: items().length === 0 }}
          >
            <For each={items()}>
              {(item) => (
                <div
                  id={typeahead.optionID(item)}
                  role="option"
                  aria-selected={typeahead.activeItem() === item}
                  aria-current={props.selected === props.key(item) ? "true" : undefined}
                  class="flex h-7 min-w-0 cursor-default select-none items-center gap-2 rounded-sm px-2 transition-opacity duration-150 aria-selected:bg-v2-overlay-simple-overlay-hover"
                  classList={{ "opacity-50": stale() }}
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
          </MenuScroll>
          {/* Stays mounted while a retry or a newer query is pending, so the list never collapses to nothing. */}
          <Show when={items().length === 0}>
            <div
              class="mx-1 flex h-9 items-center px-2 py-1 text-v2-text-text-faint"
              classList={{ invisible: !selectTypeaheadAnswered(machine()) }}
            >
              <Show when={selectTypeaheadFailed(machine())} fallback={props.emptyLabel}>
                <button
                  type="button"
                  class="-mx-2 flex h-7 flex-1 items-center rounded-sm px-2 text-start text-v2-text-text-base outline-none hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => dispatch({ type: "retry.requested" })}
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

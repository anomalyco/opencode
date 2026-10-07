import { createEffect, createMemo, For, on, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import "./message-nav-rail.css"

export type MessageNavRailItem = { id: string; text: string }

/**
 * A column of small marks along the end edge of the timeline, one per user
 * message. Hovering reveals the list of questions; clicking a mark (or an
 * entry) scrolls that message into view. On touch layouts the marks collapse
 * to a single handle that opens the same list on tap.
 */
export function MessageNavRail(props: {
  items: MessageNavRailItem[]
  getScroller: () => HTMLDivElement | undefined
  onJump: (id: string) => void
}) {
  const language = useLanguage()
  let root: HTMLDivElement | undefined

  const [state, setState] = createStore<{
    activeId?: string
    hoveredId?: string
    hover: boolean
    menu: boolean
  }>({ hover: false, menu: false })

  const items = createMemo(() => props.items)
  const visible = createMemo(() => items().length > 1)
  const popoverOpen = createMemo(() => state.hover || state.menu)

  const hoverCapable = () =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? true
      : window.matchMedia("(hover: hover) and (pointer: fine)").matches

  const updateActive = () => {
    const scroller = props.getScroller()
    if (!scroller) return
    const known = new Set(items().map((item) => item.id))
    const box = scroller.getBoundingClientRect()
    const line = box.top + 100
    const list = [...scroller.querySelectorAll<HTMLElement>("[data-message-id]")]
      .map((element) => {
        const id = element.dataset.messageId
        if (!id || !known.has(id)) return
        const rect = element.getBoundingClientRect()
        return { id, top: rect.top, bottom: rect.bottom }
      })
      .filter((item): item is { id: string; top: number; bottom: number } => !!item)
    if (!list.length) return

    const shown = list.filter((item) => item.bottom > box.top && item.top < box.bottom)
    const hit = shown.find((item) => item.top <= line && item.bottom >= line)
    const near =
      hit ??
      [...shown].sort((a, b) => {
        const da = Math.abs(a.top - line)
        const db = Math.abs(b.top - line)
        if (da !== db) return da - db
        return a.top - b.top
      })[0] ??
      list.filter((item) => item.top <= line).at(-1) ??
      list[0]

    if (near) setState("activeId", near.id)
  }

  onMount(() => {
    const onScroll = (event: Event) => {
      if (event.target !== props.getScroller()) return
      updateActive()
    }
    document.addEventListener("scroll", onScroll, true)
    onCleanup(() => document.removeEventListener("scroll", onScroll, true))
    updateActive()
  })

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!state.menu) return
      const target = event.target
      if (target instanceof Node && root?.contains(target)) return
      setState("menu", false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    onCleanup(() => document.removeEventListener("pointerdown", onPointerDown))
  })

  createEffect(
    on(
      () => items().length,
      () => queueMicrotask(updateActive),
      { defer: true },
    ),
  )

  const jump = (id: string) => {
    setState({ menu: false, activeId: id })
    props.onJump(id)
  }

  const preview = (text: string) => {
    const flat = (text ?? "").replace(/\s+/g, " ").trim()
    return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat
  }

  const label = () => state.hoveredId ?? state.activeId

  return (
    <Show when={visible()}>
      <div
        ref={root}
        class="oc-nav-rail"
        data-open={popoverOpen() ? "" : undefined}
        onMouseEnter={() => hoverCapable() && setState("hover", true)}
        onMouseLeave={() => hoverCapable() && setState({ hover: false, hoveredId: undefined })}
      >
        <div class="oc-nav-rail__track" role="navigation" aria-label={language.t("session.messages.navRail")}>
          <For each={items()}>
            {(item) => (
              <button
                type="button"
                class="oc-nav-rail__mark"
                data-active={state.activeId === item.id ? "" : undefined}
                data-hover={state.hoveredId === item.id ? "" : undefined}
                aria-label={preview(item.text)}
                onMouseEnter={() => hoverCapable() && setState("hoveredId", item.id)}
                onFocus={() => setState("hoveredId", item.id)}
                onClick={() => jump(item.id)}
              />
            )}
          </For>
        </div>

        <button
          type="button"
          class="oc-nav-rail__handle"
          aria-label={language.t("session.messages.navRail")}
          aria-expanded={popoverOpen()}
          onClick={(event) => {
            event.stopPropagation()
            setState("menu", !state.menu)
          }}
        />

        <Show when={popoverOpen()}>
          <div class="oc-nav-rail__popover" role="menu">
            <For each={items()}>
              {(item) => (
                <button
                  type="button"
                  role="menuitem"
                  class="oc-nav-rail__item"
                  data-active={label() === item.id ? "" : undefined}
                  onMouseEnter={() => setState("hoveredId", item.id)}
                  onClick={() => jump(item.id)}
                >
                  <span class="oc-nav-rail__text">{preview(item.text)}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}

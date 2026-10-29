import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { SESSION_PANES, type SessionPane } from "@/shell/state/session-tabs"

type Rect = { left: number; top: number; width: number; height: number }

/** Where a dragged tab lands: before a tab in a pane's strip (its end without `before`), or in a pane. */
export type PaneDropTarget = { pane: SessionPane; before?: string; strip: boolean; rect: Rect }

/**
 * Drags side and bottom panel tabs between panes. The strips and pane bodies mark themselves with `data-pane-strip`,
 * `data-pane-tab` and `data-pane-content`; the session row with `data-pane-row`. Dropping on a strip places the tab
 * between its neighbours, on a pane body moves it there, on the lower half of the side pane splits it, and on the
 * bottom edge of the session opens the bottom pane.
 */
export function createPaneDrag(input: {
  /** Panes that hold tabs; a pane without them is created by dropping on its zone. */
  shown: (pane: SessionPane) => boolean
  drop: (key: string, target: PaneDropTarget) => void
}) {
  const [state, setState] = createStore<{
    key?: string
    title: string
    x: number
    y: number
    target?: PaneDropTarget
  }>({ title: "", x: 0, y: 0 })

  const hit = (x: number, y: number, key: string): PaneDropTarget | undefined => {
    const inside = (rect: DOMRect) =>
      rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom

    // A scrolled strip, or one wider than its animating pane, extends past what is on screen.
    const strip = Array.from(document.querySelectorAll<HTMLElement>("[data-pane-strip]")).find((element) =>
      inside(visibleRect(element)),
    )

    const stripPane = paneOf(strip?.dataset.paneStrip)

    if (strip && stripPane) {
      const tabs = Array.from(strip.querySelectorAll<HTMLElement>("[data-pane-tab]")).filter(
        (element) => element.dataset.paneTab !== key,
      )

      const next = tabs.find((element) => {
        const rect = element.getBoundingClientRect()

        return x < rect.left + rect.width / 2
      })

      const anchor = (next ?? tabs.at(-1))?.getBoundingClientRect()
      const bounds = visibleRect(strip)

      return {
        pane: stripPane,
        before: next?.dataset.paneTab,
        strip: true,
        rect: anchor
          ? {
              left: Math.min(Math.max((next ? anchor.left : anchor.right) - 1, bounds.left), bounds.right - 2),
              top: anchor.top + 2,
              width: 2,
              height: anchor.height - 4,
            }
          : { left: bounds.left + 12, top: bounds.top + 12, width: 2, height: bounds.height - 24 },
      }
    }

    const content = Array.from(document.querySelectorAll<HTMLElement>("[data-pane-content]")).find((element) =>
      inside(element.getBoundingClientRect()),
    )

    const contentPane = paneOf(content?.dataset.paneContent)

    if (content && contentPane) {
      const rect = content.getBoundingClientRect()

      if (contentPane === "side" && !input.shown("split") && y > rect.top + rect.height / 2)
        return {
          pane: "split",
          strip: false,
          rect: { left: rect.left, top: rect.top + rect.height / 2, width: rect.width, height: rect.height / 2 },
        }

      return { pane: contentPane, strip: false, rect: toRect(rect) }
    }

    const chat = document.querySelector<HTMLElement>('[data-slot="session-chat-panel"]')?.getBoundingClientRect()
    const row = document.querySelector<HTMLElement>("[data-pane-row]")?.getBoundingClientRect()

    if (!chat || !row || input.shown("bottom") || !inside(chat) || y < chat.bottom - chat.height / 4) return
    const height = Math.min(280, row.height / 3)

    return {
      pane: "bottom",
      strip: false,
      rect: { left: row.left, top: row.bottom - height, width: row.width, height },
    }
  }

  const start = (event: PointerEvent, key: string, title: string) => {
    if (event.button !== 0) return
    const origin = { x: event.clientX, y: event.clientY }
    const drag = { active: false }
    const swallow = (click: MouseEvent) => click.stopPropagation()

    const move = (moved: PointerEvent) => {
      if (!drag.active && Math.hypot(moved.clientX - origin.x, moved.clientY - origin.y) < 4) return

      if (!drag.active) {
        drag.active = true
        document.body.style.userSelect = "none"
      }

      const target = hit(moved.clientX, moved.clientY, key)
      // Away from any drop target the release cancels, so the cursor stays normal.
      document.body.style.cursor = target ? "grabbing" : ""
      setState({ key, title, x: moved.clientX, y: moved.clientY, target })
    }

    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      window.removeEventListener("keydown", escape, true)

      if (!drag.active) return
      const target = state.target
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      setState({ key: undefined, target: undefined })
      // The release over the strip would click whatever tab is under it.
      window.addEventListener("click", swallow, true)
      setTimeout(() => window.removeEventListener("click", swallow, true))

      if (commit && target) input.drop(key, target)
    }

    const up = () => finish(true)
    const cancel = () => finish(false)

    const escape = (keyboard: KeyboardEvent) => {
      if (keyboard.key !== "Escape") return
      keyboard.preventDefault()
      keyboard.stopPropagation()
      finish(false)
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
    window.addEventListener("keydown", escape, true)
  }

  return {
    /** The dragged tab's key while a drag runs. */
    dragging: () => state.key,
    start,
    Layer: () => (
      <Show when={state.key}>
        <Portal>
          <div class="fixed inset-0 z-[100] pointer-events-none" data-component="pane-drag-layer">
            <Show when={state.target}>
              {(target) => (
                <div
                  data-slot={target().strip ? "pane-drop-indicator" : "pane-drop-zone"}
                  data-pane={target().pane}
                  class="absolute"
                  classList={{
                    "bg-v2-icon-icon-accent rounded-full": target().strip,
                    "rounded-[10px] border border-v2-icon-icon-accent bg-[color-mix(in_srgb,var(--v2-icon-icon-accent)_12%,transparent)]":
                      !target().strip,
                  }}
                  style={{
                    left: `${target().rect.left}px`,
                    top: `${target().rect.top}px`,
                    width: `${target().rect.width}px`,
                    height: `${target().rect.height}px`,
                  }}
                />
              )}
            </Show>
            <div
              class="absolute max-w-60 h-7 px-2.5 flex items-center rounded-md bg-v2-background-bg-base text-13-regular text-v2-text-text-base truncate shadow-[var(--v2-elevation-raised)] opacity-90"
              style={{ left: `${state.x + 12}px`, top: `${state.y + 12}px` }}
            >
              {state.title}
            </div>
          </div>
        </Portal>
      </Show>
    ),
  }
}

export type PaneDrag = ReturnType<typeof createPaneDrag>

function paneOf(value: string | undefined) {
  return SESSION_PANES.find((pane) => pane === value)
}

/** The element's on-screen rect: its bounding rect clipped by every ancestor that clips overflow. */
function visibleRect(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const bounds = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }

  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent)

    if (style.overflowX === "visible" && style.overflowY === "visible") continue
    const clip = parent.getBoundingClientRect()
    bounds.left = Math.max(bounds.left, clip.left)
    bounds.top = Math.max(bounds.top, clip.top)
    bounds.right = Math.min(bounds.right, clip.right)
    bounds.bottom = Math.min(bounds.bottom, clip.bottom)
  }

  return new DOMRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
}

function toRect(rect: DOMRect): Rect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

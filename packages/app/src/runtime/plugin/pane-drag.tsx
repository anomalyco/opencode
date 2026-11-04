import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack, type Accessor } from "solid-js"
import { Portal } from "solid-js/web"
import { SESSION_PANES, type SessionPane } from "@/shell/state/session-tabs"
import {
  INITIAL_PANE_DRAG_STATE,
  selectDraggingKey,
  selectDragLayer,
  selectMoveKey,
  transitionPaneDrag,
  type PaneDragEffect,
  type PaneDragEvent,
  type PaneDragState,
  type PaneDropTarget,
  type Rect,
} from "./pane-drag-machine"

/**
 * Drags side and bottom panel tabs between panes. The strips and pane bodies mark themselves with `data-pane-strip`,
 * `data-pane-tab` and `data-pane-content`; the session row with `data-pane-row`. Dropping on a strip places the tab
 * between its neighbours, on a pane body moves it there, on the lower half of the side pane splits it, and on the
 * bottom edge of the session opens the bottom pane.
 */
export function createPaneDrag(input: {
  /** The session whose tabs drag; a change cancels the gesture, so a release cannot move a tab in another session. */
  identity: Accessor<unknown>
  /** Panes that hold tabs; a pane without them is created by dropping on its zone. */
  shown: (pane: SessionPane) => boolean
  drop: (key: string, target: PaneDropTarget) => void
}) {
  const [paneDrag, setPaneDrag] = createSignal<PaneDragState>(INITIAL_PANE_DRAG_STATE)
  const dragging = createMemo(() => selectDraggingKey(paneDrag()))
  const layer = createMemo(() => selectDragLayer(paneDrag()))

  let clearSuppression: (() => void) | undefined

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

  const dispatch = (event: PaneDragEvent) => {
    const previous = untrack(paneDrag)
    const next = transitionPaneDrag(previous, event)

    if (next.state === previous) return false
    setPaneDrag(next.state)
    next.effects.forEach(run)

    return true
  }

  const move = (event: PointerEvent) => {
    // Only the gesture's pointer, once it drags, hit-tests the drop zones.
    const key = selectMoveKey(untrack(paneDrag), event.pointerId, event.clientX, event.clientY)

    if (key === undefined) return
    dispatch({
      type: "pointer.move",
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target: hit(event.clientX, event.clientY, key),
    })
  }

  const up = (event: PointerEvent) => dispatch({ type: "pointer.up", pointerId: event.pointerId })
  const cancel = (event: PointerEvent) => dispatch({ type: "pointer.cancel", pointerId: event.pointerId })
  // Leaving the window loses the release, which would leave the drag stuck.
  const blur = () => dispatch({ type: "blur" })

  const escape = (keyboard: KeyboardEvent) => {
    if (keyboard.key !== "Escape" || !dispatch({ type: "escape" })) return
    keyboard.preventDefault()
    keyboard.stopPropagation()
  }

  const swallow = (click: MouseEvent) => click.stopPropagation()

  const run = (effect: PaneDragEffect) => {
    if (effect.type === "gesture.attach") {
      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", up)
      window.addEventListener("pointercancel", cancel)
      window.addEventListener("blur", blur)
      window.addEventListener("keydown", escape, true)

      return
    }

    if (effect.type === "gesture.cleanup") {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      window.removeEventListener("blur", blur)
      window.removeEventListener("keydown", escape, true)

      if (!effect.unlockBody) return
      document.body.style.userSelect = ""
      document.body.style.cursor = ""

      return
    }

    if (effect.type === "body.lock") {
      document.body.style.userSelect = "none"
      document.body.style.cursor = effect.cursor

      return
    }

    if (effect.type === "body.cursor") {
      document.body.style.cursor = effect.cursor

      return
    }

    if (effect.type === "click-suppression.arm") {
      clearSuppression?.()
      window.addEventListener("click", swallow, true)
      const timer = setTimeout(() => clearSuppression?.())
      clearSuppression = () => {
        clearTimeout(timer)
        window.removeEventListener("click", swallow, true)
        clearSuppression = undefined
      }

      return
    }

    if (effect.type === "click-suppression.clear") {
      clearSuppression?.()

      return
    }

    input.drop(effect.key, effect.target)
  }

  createEffect(on(input.identity, () => void dispatch({ type: "session.changed" }), { defer: true }))
  onCleanup(() => void dispatch({ type: "disposed" }))

  return {
    /** The dragged tab's key while a drag runs. */
    dragging,
    start: (event: PointerEvent, key: string, title: string) =>
      void dispatch({
        type: "pointer.down",
        pointerId: event.pointerId,
        button: event.button,
        x: event.clientX,
        y: event.clientY,
        key,
        title,
      }),
    Layer: () => (
      <Show when={layer()}>
        {(current) => (
          <Portal>
            <div class="fixed inset-0 z-[100] pointer-events-none" data-component="pane-drag-layer">
              <Show when={current().target}>
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
                style={{ left: `${current().x + 12}px`, top: `${current().y + 12}px` }}
              >
                {current().title}
              </div>
            </div>
          </Portal>
        )}
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

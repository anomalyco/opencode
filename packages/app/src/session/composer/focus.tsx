import {
  createComputed,
  createContext,
  createSignal,
  onCleanup,
  untrack,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { useDialog } from "@opencode/ui/context/dialog"
import { setCursorPosition } from "@/composer/editor/dom"
import {
  createComposerFocusState,
  transitionComposerFocus,
  type ComposerFocusEffect,
  type ComposerFocusEvent,
} from "./focus-machine"

// A composer that can take focus for one session: the pending session's composer or the session composer.
type ComposerSurface = {
  target: Accessor<string>
  element: Accessor<HTMLElement | undefined>
  editable?: Accessor<boolean>
}

export type ComposerFocus = ReturnType<typeof createComposerFocus>

const ComposerFocusContext = createContext<ComposerFocus>()

// One machine for the session route, so focus outlives the pending composer until the session composer mounts.
export function ComposerFocusProvider(props: ParentProps<{ sessionID: string }>) {
  const focus = createComposerFocus()

  // A computation, not an effect: the target changes before the new session's composers mount and report to it.
  createComputed(() => focus.dispatch({ type: "target.changed", target: props.sessionID }))

  return <ComposerFocusContext.Provider value={focus}>{props.children}</ComposerFocusContext.Provider>
}

// Outside the session route (stories), a session composer focuses itself as it does when a session opens.
export function useComposerFocus(sessionID: string) {
  const routed = useContext(ComposerFocusContext)

  if (routed) return routed
  const focus = createComposerFocus()
  focus.dispatch({ type: "target.changed", target: sessionID })

  return focus
}

// The tab link that opened the session passes focus on, unless it sits in a dialog, such as the mobile tabs drawer
// reopened before the composer.
export function isTitlebarTabLink(element: Element) {
  return element.matches("[data-titlebar-tab-link]") && !element.closest('[role="dialog"]')
}

function createComposerFocus() {
  const dialog = useDialog()
  const [state, setState] = createSignal(createComposerFocusState())
  let frame: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let preparing: ComposerSurface | undefined
  let real: ComposerSurface | undefined

  const dispatch = (event: ComposerFocusEvent) => {
    const previous = untrack(state)
    const result = transitionComposerFocus(previous, event)

    if (result.state === previous) return
    setState(result.state)
    result.effects.forEach(run)
  }

  const run = (effect: ComposerFocusEffect) => {
    if (effect.type === "frame.cancel") return cancelFrame()

    if (effect.type === "timer.clear") return clearTimer()

    if (effect.type === "timer.start") {
      clearTimer()
      timer = setTimeout(() => {
        timer = undefined
        dispatch({ type: "timeout", attempt: effect.attempt })
      }, effect.delayMs)

      return
    }

    cancelFrame()
    // One frame after mounting, so the editor's content and the outgoing composer's DOM have settled.
    frame = requestAnimationFrame(() => {
      frame = undefined

      if (effect.type === "frame.real") {
        dispatch({ type: "real.frame", attempt: effect.attempt, outcome: focusSurface(real, effect) })

        return
      }

      const outcome = focusSurface(preparing, effect) === "focused" ? "focused" : "blocked"
      dispatch({ type: "preparing.frame", attempt: effect.attempt, outcome })
    })
  }

  const focusSurface = (
    surface: ComposerSurface | undefined,
    effect: { target: string; cursor: number },
  ): "focused" | "claimed" | "blocked" => {
    const element = surface?.target() === effect.target ? surface.element() : undefined

    if (!element?.isConnected || surface?.editable?.() === false || dialog.active) return "blocked"
    const active = document.activeElement

    // The user already put the caret in this composer.
    if (active && element.contains(active)) return "focused"

    // A control chosen while the session was loading owns focus now.
    if (active && active !== document.body && !isTitlebarTabLink(active)) return "claimed"
    element.focus({ preventScroll: true })
    setCursorPosition(element, effect.cursor)

    return "focused"
  }

  const cancelFrame = () => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
    frame = undefined
  }

  const clearTimer = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    state,
    dispatch,
    bindPreparing(surface: ComposerSurface) {
      preparing = surface
      onCleanup(() => {
        if (preparing === surface) preparing = undefined
      })
    },
    bindReal(surface: ComposerSurface) {
      real = surface
      onCleanup(() => {
        if (real === surface) real = undefined
      })
    },
  }
}

import { createSignal, onCleanup, untrack } from "solid-js"
import {
  initialRenameState,
  isRenaming,
  renameDraft,
  transitionRename,
  type RenameEvent,
  type RenameSource,
} from "./rename-machine"

/** The rename field while it is mounted, and the frame that arms it. */
type InlineRenameField = { input?: HTMLInputElement; frame?: number }

/** The inline rename of a terminal's tab, in the side panel strip and the narrow-screen view alike. */
export function createInlineRename(options: {
  title: () => string
  /** Receives the edited title, or `null` for an emptied field; without it the terminal cannot be renamed. */
  rename: () => ((title: string | null) => void) | undefined
}) {
  const [state, setState] = createSignal(initialRenameState)
  const field: InlineRenameField = {}

  onCleanup(disarm)

  return {
    editing: () => isRenaming(state()),
    draft: () => renameDraft(state()),
    ref(input: HTMLInputElement) {
      field.input = input
    },
    start(source: RenameSource) {
      dispatch({ type: "start", title: options.title(), source, enabled: options.rename() !== undefined })
    },
    change: (value: string) => dispatch({ type: "change", value }),
    blur: () => dispatch({ type: "blur" }),
    keydown(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== "Escape") return
      event.preventDefault()
      dispatch({ type: event.key === "Enter" ? "submit" : "cancel" })
    },
    /** The tab's context menu closed: the field, not the trigger, takes focus while renaming. */
    closeAutoFocus(event: Event) {
      const current = untrack(state)

      if (current.status === "idle") return
      event.preventDefault()

      if (current.status === "arming" && current.source === "menu") arm(current.attempt)
    },
  }

  function dispatch(event: RenameEvent) {
    const previous = untrack(state)
    const next = transitionRename(previous, event)

    if (next.state !== previous) setState(next.state)
    next.effects.forEach((effect) => {
      if (effect.type === "disarm") return disarm()

      if (effect.type === "save") return options.rename()?.(effect.title)

      // A menu pick arms once the menu has closed, from `closeAutoFocus`.
      if (effect.source === "menu") return
      field.input?.focus()
      field.input?.select()
      arm(effect.attempt)
    })
  }

  // Next frame the field holds focus, so a blur ends the edit from then on.
  function arm(attempt: number) {
    disarm()
    field.frame = requestAnimationFrame(() => {
      field.frame = undefined
      const current = untrack(state)

      if (current.status !== "arming" || current.attempt !== attempt) return

      if (field.input && document.activeElement !== field.input) {
        field.input.focus()

        if (!current.edited) field.input.select()
      }

      dispatch({ type: "armed", attempt })
    })
  }

  function disarm() {
    if (field.frame !== undefined) cancelAnimationFrame(field.frame)
    field.frame = undefined
  }
}

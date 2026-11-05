import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { ComposerEditor } from "@/composer/editor/editor"
import { getCursorPosition } from "@/composer/editor/dom"
import { createComposerEditor } from "@/composer/editor/interaction"
import { promptLength } from "@/composer/prompt-parts"
import type { PendingSession } from "@/shell/tabs/tabs"
import { isTitlebarTabLink, useComposerFocus } from "./composer/focus"

export function PreparingComposer(props: { sessionID: string; pending: PendingSession }) {
  const focus = useComposerFocus(props.sessionID)
  const [element, setElement] = createSignal<HTMLElement>()

  const editor = createComposerEditor({
    store: () => props.pending.composer.store,
    commands: () => [],
    context: () => [],
    searchContextFiles: () => [],
    onEditor: setElement,
    view: {
      draftOnly: true,
      submit: { stopping: () => false, onSubmit() {}, onStop() {} },
    },
  })

  focus.bindPreparing({ target: () => props.sessionID, element })

  createEffect(() => {
    const el = element()

    if (!el) return
    makeEventListener(el, "focusin", () => focus.dispatch({ type: "preparing.focused", target: props.sessionID }))
    makeEventListener(el, "focusout", (event) => {
      // Removing the editor, or the window losing focus, is not the user leaving it.
      if (!el.isConnected || !document.hasFocus() || document.activeElement === el) return

      if (event.relatedTarget instanceof Element && isTitlebarTabLink(event.relatedTarget)) return
      focus.dispatch({ type: "preparing.blurred", target: props.sessionID })
    })
    // The editor stores the caret only on input, key up and pointer up. Keep it current while a key is held, so
    // the draft that moves into the created session carries the caret.
    makeEventListener(document, "selectionchange", () => {
      if (document.activeElement !== el) return
      const cursor = getCursorPosition(el)

      if (cursor !== undefined && cursor !== props.pending.composer.cursor()) editor.onCursor(cursor)
    })
  })

  createEffect(
    on(
      () => props.pending,
      (pending) => {
        const target = props.sessionID
        const cursor = () => pending.composer.cursor() ?? promptLength(pending.composer.current())
        focus.dispatch({ type: "preparing.mounted", target, cursor: cursor() })
        onCleanup(() => {
          const el = element()
          focus.dispatch({ type: "preparing.unmounted", target, cursor: (el && getCursorPosition(el)) ?? cursor() })
        })
      },
    ),
  )

  return (
    <div data-component="session-composer-dock" class="w-full shrink-0 bg-v2-background-bg-base pb-3">
      <div class="mx-auto w-full px-3 md:max-w-session">
        <ComposerEditor controller={editor} modelControlsVisible={false} />
      </div>
    </div>
  )
}

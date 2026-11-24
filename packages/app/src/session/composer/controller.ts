import { createEffect, createMemo, createSignal, on, onMount, untrack, type Accessor } from "solid-js"
import { useDialog } from "@opencode/ui/context/dialog"
import type { ComposerControls } from "@/composer/adapter"
import { setCursorPosition } from "@/composer/editor/dom"
import { promptLength } from "@/composer/prompt-parts"
import { createComposerModel } from "@/composer/model"
import { useSettings } from "@/settings/model"
import { createActiveComposerAdapter } from "./adapter"
import { useComposerFocus } from "./focus"
import { needsRealComposerFocus } from "./focus-machine"
import { createSessionQueue } from "./queue"
import { createSessionComposerRegionController } from "./session-composer-region-controller"

export function createSessionComposerController(input: {
  sessionID: string
  sessionKey: Accessor<string>
  controls: Accessor<ComposerControls>
  dock: Parameters<typeof createSessionComposerRegionController>[0]
}) {
  const settings = useSettings()
  const dialog = useDialog()
  const focus = useComposerFocus(input.sessionID)
  const region = createSessionComposerRegionController(input.dock)
  const [editor, setEditor] = createSignal<HTMLDivElement>()

  const background = () => input.dock.state.background.steer(input.sessionID)

  const adapter = createActiveComposerAdapter({
    sessionID: input.sessionID,
    sessionKey: input.sessionKey,
    controls: input.controls,
    submitted: region.onResponseSubmit,
    background,
    setEditor: (element) => {
      setEditor(element)
      region.setPromptRef(element)
    },
  })

  const queue = createSessionQueue({
    sessionID: input.sessionID,
    draft: adapter.state,
    working: adapter.working,
    behavior: settings.general.followUpBehavior,
    background,
    restoreFocus: (cursor) => {
      const target = editor()

      if (!target) return
      requestAnimationFrame(() => {
        target.focus()
        setCursorPosition(target, cursor)
      })
    },
  })

  const composer = createComposerModel(adapter, { queue })
  const editable = createMemo(() => region.showComposer() && !region.child())
  // This controller is recreated when a session becomes active, which is when its composer takes focus
  // (focus-machine.ts). It waits for the draft, the editor and any request dock or dialog to clear.
  focus.bindReal({ target: () => input.sessionID, element: editor, editable })
  onMount(() => focus.dispatch({ type: "real.mounted", target: input.sessionID }))
  createEffect(() => {
    if (!needsRealComposerFocus(focus.state(), input.sessionID)) return

    if (!adapter.ready() || !editor() || !editable() || dialog.active) return
    const cursor = untrack(() => adapter.state.cursor() ?? promptLength(adapter.state.current()))
    focus.dispatch({ type: "real.ready", target: input.sessionID, cursor })
  })
  // Requests hide the view without disposing its draft or queue edit.
  createEffect(on(editable, () => composer.clearDrag()))

  return {
    region,
    queue,
    composer,
    drop: {
      active: () => editable() && composer.state.drag === "active",
      input: () => composer.model.selection.current()?.capabilities.input,
    },
  }
}

export type SessionComposerController = ReturnType<typeof createSessionComposerController>

import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js"
import { useDialog } from "@opencode/ui/context/dialog"
import type { ComposerControls } from "@/composer/adapter"
import { setCursorPosition } from "@/composer/editor/dom"
import { promptLength } from "@/composer/prompt-parts"
import { createComposerModel } from "@/composer/model"
import { useSettings } from "@/settings/model"
import { createActiveComposerAdapter } from "./adapter"
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
  const region = createSessionComposerRegionController(input.dock)
  let editor: HTMLDivElement | undefined

  const background = () => input.dock.state.background.steer(input.sessionID)

  const adapter = createActiveComposerAdapter({
    sessionID: input.sessionID,
    sessionKey: input.sessionKey,
    controls: input.controls,
    submitted: region.onResponseSubmit,
    background,
    setEditor: (element) => {
      editor = element
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
      const target = editor

      if (!target) return
      requestAnimationFrame(() => {
        target.focus()
        setCursorPosition(target, cursor)
      })
    },
  })

  const composer = createComposerModel(adapter, { queue })
  // This controller is recreated when a session becomes active. Wait for its draft and
  // the editor's DOM commit, without reacting to subsequent cursor or message updates.
  createEffect(
    on(adapter.ready, (ready) => {
      if (!ready) return

      const frame = requestAnimationFrame(() => {
        if (!editor?.isConnected || !region.showComposer() || region.child() || dialog.active) return
        const active = document.activeElement

        // A control chosen while the session was loading owns focus now.
        if (active && active !== document.body && active !== editor && !active.matches("[data-titlebar-tab-link]"))
          return
        editor.focus({ preventScroll: true })
        setCursorPosition(editor, adapter.state.cursor() ?? promptLength(adapter.state.current()))
      })

      onCleanup(() => cancelAnimationFrame(frame))
    }),
  )
  const editable = createMemo(() => region.showComposer() && !region.child())
  // Requests hide the view without disposing its draft or queue edit.
  createEffect(on(editable, () => composer.onDragLeave()))

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

import { createEffect, createMemo, on, type Accessor } from "solid-js"
import type { ComposerControls } from "@/composer/adapter"
import { setCursorPosition } from "@/composer/editor/dom"
import { createComposerModel } from "@/composer/model"
import { useSettings } from "@/settings/model"
import { createActiveComposerAdapter } from "./adapter"
import { createSessionQueue } from "./queue"
import { createSessionComposerRegionController } from "./session-composer-region-controller"

export function createSessionComposerController(input: {
  sessionID: string
  controls: Accessor<ComposerControls>
  dock: Parameters<typeof createSessionComposerRegionController>[0]
}) {
  const settings = useSettings()
  const region = createSessionComposerRegionController(input.dock)
  let editor: HTMLDivElement | undefined
  const adapter = createActiveComposerAdapter({
    sessionID: input.sessionID,
    controls: input.controls,
    submitted: region.onResponseSubmit,
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

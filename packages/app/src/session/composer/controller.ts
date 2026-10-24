import { createEffect, createMemo, on, type Accessor } from "solid-js"
import type { ComposerControls } from "@/composer/adapter"
import { setCursorPosition } from "@/composer/editor/dom"
import { createComposerModel } from "@/composer/model"
import { createComposerPrediction } from "@/composer/prediction"
import { useDialog } from "@opencode/ui/context/dialog"
import { useServerSDK } from "@/runtime/server/client"
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
  const server = useServerSDK()
  const dialog = useDialog()
  const region = createSessionComposerRegionController(input.dock)
  let editor: HTMLDivElement | undefined

  const adapter = createActiveComposerAdapter({
    sessionID: input.sessionID,
    sessionKey: input.sessionKey,
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

  const editable = createMemo(() => region.showComposer() && !region.child())
  const composer = createComposerModel(adapter, { queue })
  composer.view.prediction = createComposerPrediction({
    sessionID: input.sessionID,
    sdk: server,
    eligible: () =>
      settings.general.composerPredictions() &&
      server.connection.status() === "connected" &&
      editable() &&
      adapter.ready() &&
      !adapter.working() &&
      !dialog.active &&
      queue.count() === 0 &&
      !queue.editing() &&
      composer.state.mode === "normal" &&
      composer.state.popover.type === "closed" &&
      composer.uploads().length === 0 &&
      adapter.state.context.items().length === 0 &&
      adapter.state.current().every((part) => part.type === "text" && part.content.length === 0),
  })
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

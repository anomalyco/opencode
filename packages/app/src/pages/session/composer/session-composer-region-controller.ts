import { type Accessor, createEffect, createMemo, createResource } from "solid-js"
import type { PromptInputState } from "@/components/prompt-input"
import { useSync } from "@/context/sync"
import { getSessionHandoff, setSessionHandoff } from "@/pages/session/handoff"
import type { SessionComposerController } from "./session-composer-state"

export type SessionComposerFollowupDock = {
  items: { id: string; text: string }[]
  sending?: string
  onSend: (id: string) => void
  onEdit: (id: string) => void
}

export type SessionComposerRevertDock = {
  items: { id: string; text: string }[]
  restoring?: string
  disabled?: boolean
  onRestore: (id: string) => void
}

export function createSessionComposerRegionController(input: {
  state: SessionComposerController
  sessionKey: Accessor<string>
  sessionID: Accessor<string | undefined>
  prompt: PromptInputState
  centered: Accessor<boolean>
  followup: Accessor<SessionComposerFollowupDock | undefined>
  revert: Accessor<SessionComposerRevertDock | undefined>
  onResponseSubmit: () => void
  openParent: () => void
  setPromptRef: (el: HTMLDivElement) => void
  setDockRef: (el: HTMLDivElement) => void
}) {
  const sync = useSync()

  createEffect(() => {
    if (!input.prompt.ready()) return
    setSessionHandoff(input.sessionKey(), {
      prompt: input.prompt
        .current()
        .map((part) => {
          if (part.type === "file") return `[file:${part.path}]`
          if (part.type === "agent") return `@${part.name}`
          if (part.type === "image") return `[image:${part.filename}]`
          return part.content
        })
        .join("")
        .trim(),
    })
  })

  const parentID = createMemo(() => {
    const id = input.sessionID()
    return id ? sync().session.get(id)?.parentID : undefined
  })
  const ready = Promise.resolve()
  const [promptReady] = createResource(
    () => input.prompt.ready.promise ?? ready,
    (promise) => promise.then(() => true),
  )

  return {
    state: input.state,
    centered: input.centered,
    followup: input.followup,
    revert: input.revert,
    onResponseSubmit: input.onResponseSubmit,
    openParent: input.openParent,
    setPromptRef: input.setPromptRef,
    setDockRef: input.setDockRef,
    parentID,
    child: () => !!parentID(),
    showComposer: () => !input.state.blocked() || !!parentID(),
    handoffPrompt: () => getSessionHandoff(input.sessionKey())?.prompt,
    promptReady: () => input.prompt.ready() || promptReady(),
    lift: () => (input.revert()?.items.length ? 18 : 0),
  }
}

export type SessionComposerRegionController = ReturnType<typeof createSessionComposerRegionController>

import { type Accessor, createEffect, createMemo, createResource } from "solid-js"
import type { useComposerState } from "@/composer/persistence"
import { useData } from "@/runtime/server/current"
import { getSessionHandoff, setSessionHandoff } from "@/session/handoff"
import type { SessionRequestModel } from "../requests/model"

export function createSessionComposerRegionController(input: {
  state: SessionRequestModel
  sessionKey: Accessor<string>
  sessionID: Accessor<string | undefined>
  prompt: ReturnType<typeof useComposerState>
  centered: Accessor<boolean>
  onResponseSubmit: () => void
  openParent: () => void
  setPromptRef: (el: HTMLDivElement) => void
  setDockRef: (el: HTMLDivElement) => void
}) {
  const data = useData()
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
    return id ? data.session.get(id)?.parentID : undefined
  })
  const ready = Promise.resolve()
  const [promptReady] = createResource(
    () => input.prompt.ready.promise ?? ready,
    (promise) => promise.then(() => true),
  )

  return {
    state: input.state,
    centered: input.centered,
    onResponseSubmit: input.onResponseSubmit,
    openParent: input.openParent,
    setPromptRef: input.setPromptRef,
    setDockRef: input.setDockRef,
    parentID,
    child: () => !!parentID(),
    showComposer: () => !input.state.blocked() || !!parentID(),
    handoffPrompt: () => getSessionHandoff(input.sessionKey())?.prompt,
    promptReady: () => input.prompt.ready() || promptReady(),
  }
}

export type SessionComposerRegionController = ReturnType<typeof createSessionComposerRegionController>

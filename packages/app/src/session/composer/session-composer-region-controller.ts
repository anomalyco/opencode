import { type Accessor, createMemo } from "solid-js"
import { useData } from "@/runtime/server/current"
import type { SessionRequestModel } from "../requests/model"

export function createSessionComposerRegionController(input: {
  state: SessionRequestModel
  sessionID: Accessor<string | undefined>
  centered: Accessor<boolean>
  onResponseSubmit: () => void
  openParent: () => void
  setPromptRef: (el: HTMLDivElement) => void
  setDockRef: (el: HTMLDivElement) => void
}) {
  const data = useData()
  const parentID = createMemo(() => {
    const id = input.sessionID()
    return id ? data.session.get(id)?.parentID : undefined
  })
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
  }
}

export type SessionComposerRegionController = ReturnType<typeof createSessionComposerRegionController>

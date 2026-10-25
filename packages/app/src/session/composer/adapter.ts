import type { Accessor } from "solid-js"
import type { ActiveComposerAdapter, ComposerControls } from "@/composer/adapter"
import { useComposerState } from "@/composer/persistence"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { createSessionMessageHandoff } from "@/session/handoff"
import { useWorkspaceLocation } from "@/workspaces/location"

export function createActiveComposerAdapter(input: {
  sessionID: string
  sessionKey: Accessor<string>
  controls: Accessor<ComposerControls>
  submitted: () => void
  setEditor: (element: HTMLDivElement) => void
}) {
  const id = input.sessionID

  const prompt = useComposerState()
  prompt.current()
  const state = prompt.capture()
  const data = useData()
  const server = useServerSDK()
  const location = useWorkspaceLocation()

  const adapter: ActiveComposerAdapter = {
    kind: "active-session",
    state,
    ready: prompt.ready,
    controls: input.controls,
    working: () => data.session.status(id) === "running",
    submitted: input.submitted,
    setEditor: input.setEditor,
    session: () => ({
      id,
      directory: location().directory,
      handoff: createSessionMessageHandoff(input.sessionKey(), id, server.event),
      api: server.api.session,
      data,
      current: () => data.session.get(id),
      admitted: (messageID) => data.session.input.has(id, messageID) || !!data.session.message.get(id, messageID),
    }),
    interrupt: () =>
      server.api.session
        .interrupt({ sessionID: id, resume: true })
        .then(() => undefined)
        .catch(() => undefined),
  }

  return adapter
}

import type { Accessor } from "solid-js"
import type { ActiveComposerAdapter, ComposerControls } from "@/composer/adapter"
import { useComposerState } from "@/composer/persistence"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import type { SessionModel } from "../model"

export function createActiveComposerAdapter(input: {
  session: SessionModel
  controls: Accessor<ComposerControls>
  submitted: () => void
  setEditor: (element: HTMLDivElement) => void
}) {
  const id = input.session.identity.params.id
  if (!id) throw new Error("Active Composer requires a Session ID")

  const prompt = useComposerState()
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
      api: server.api.session,
      data,
      current: () => data.session.get(id),
      admitted: (messageID) => data.session.input.has(id, messageID) || !!data.session.message.get(id, messageID),
    }),
    interrupt: () => server.api.session.interrupt({ sessionID: id, continue: true }).catch(() => undefined),
  }
  return adapter
}

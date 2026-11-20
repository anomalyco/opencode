import type { Accessor } from "solid-js"
import type { ActiveComposerAdapter, ComposerControls, ComposerSession } from "@/composer/adapter"
import { useComposerState } from "@/composer/persistence"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useTabs } from "@/shell/tabs/tabs"
import { ServerConnection } from "@/runtime/server/registry"

/** A prompt is admitted once its inbox row exists, and stays admitted when its durable message replaces that row. */
export function createSessionAdmitted(
  data: {
    session: {
      input: { has: (sessionID: string, messageID: string) => boolean }
      message: { get: (sessionID: string, messageID: string) => object | undefined }
    }
  },
  sessionID: string,
) {
  return (messageID: string) =>
    data.session.input.has(sessionID, messageID) || !!data.session.message.get(sessionID, messageID)
}

export function createActiveComposerAdapter(input: {
  sessionID: string
  sessionKey: Accessor<string>
  controls: Accessor<ComposerControls>
  submitted: () => void
  setEditor: (element: HTMLDivElement) => void
  background: NonNullable<ComposerSession["background"]>
}) {
  const id = input.sessionID

  const prompt = useComposerState()
  prompt.current()
  const state = prompt.capture()
  const data = useData()
  const handoff = useServer().ctx.handoff.forSession(id)
  const server = useServerSDK()
  const location = useWorkspaceLocation()

  const tabs = useTabs()

  const preview = tabs.preview()

  const adapter: ActiveComposerAdapter = {
    kind: "active-session",
    state,
    ready: prompt.ready,
    controls: input.controls,
    working: () => data.session.status(id) === "running",
    beforeSubmit:
      preview?.server === ServerConnection.key(server.server) &&
      (preview.sessionId === id || preview.sessionId === data.session.root(id))
        ? () => tabs.keepPreview(preview)
        : undefined,
    submitted: input.submitted,
    setEditor: input.setEditor,
    session: () => ({
      id,
      directory: location().directory,
      handoff,
      api: server.api.session,
      file: server.api.file,
      data,
      current: () => data.session.get(id),
      admitted: createSessionAdmitted(data, id),
      background: input.background,
    }),
    interrupt: () =>
      server.api.session
        .interrupt({ sessionID: id, resume: true })
        .then(() => undefined)
        .catch(() => undefined),
  }

  return adapter
}

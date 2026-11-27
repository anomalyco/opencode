import type { Accessor } from "solid-js"
import type { ActiveComposerAdapter, ComposerControls, ComposerSession } from "@/composer/adapter"
import { useComposerState } from "@/composer/persistence"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useTabs } from "@/shell/tabs/tabs"
import { ServerConnection } from "@/runtime/server/registry"

export function createActiveComposerAdapter(input: {
  sessionID: string
  sessionKey: Accessor<string>
  controls: Accessor<ComposerControls>
  submitted: () => void
  setEditor: (element: HTMLDivElement) => void
  background: NonNullable<ComposerSession["background"]>
  takeBack: () => Promise<void>
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
      admitted: (messageID) => data.session.input.has(id, messageID) || !!data.session.message.get(id, messageID),
      background: input.background,
    }),
    // Stopping before the model has answered with text or a tool call takes the prompt back, as undo does: the
    // likeliest reason to stop that early is to reword what was just sent. A draft or a pending prompt means the user
    // has moved on to something else, so those only stop.
    interrupt: async () => {
      const takeBack =
        state.current().every((part) => part.type === "text" && part.content.trim() === "") &&
        state.context.items().length === 0 &&
        data.session.pending.list(id).length === 0

      const result = await server.api.session.interrupt({ sessionID: id, resume: true }).catch(() => undefined)

      // A repeated Stop finds the execution already stopping and reports nothing interrupted.
      if (takeBack && result?.interrupted) await input.takeBack().catch(() => undefined)
    },
  }

  return adapter
}

import { notifySessionTabsRemoved } from "@/components/titlebar-session-events"
import type { ServerConnection } from "@/context/server"

type HomeSession = {
  id: string
  directory: string
}

type SessionUpdate = {
  directory: string
  sessionID: string
  time: { archived: number }
}

export async function archiveHomeSession(input: {
  server: ServerConnection.Key
  session: HomeSession
  update: (value: SessionUpdate) => Promise<unknown>
  remove: () => void
  onError?: (error: unknown) => void
}) {
  await input
    .update({
      directory: input.session.directory,
      sessionID: input.session.id,
      time: { archived: Date.now() },
    })
    .then(() => {
      input.remove()
      notifySessionTabsRemoved({
        server: input.server,
        directory: input.session.directory,
        sessionIDs: [input.session.id],
      })
    })
    .catch((error) => input.onError?.(error))
}

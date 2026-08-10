import { notifySessionTabsRemoved } from "@/components/titlebar-session-events"
import type { ServerConnection } from "@/context/server"

type HomeSession = {
  id: string
  directory: string
}

export async function archiveHomeSession(input: {
  server: ServerConnection.Key
  session: HomeSession
  archive: (sessionID: string) => Promise<unknown>
  remove: () => void
  onError?: (error: unknown) => void
}) {
  await input
    .archive(input.session.id)
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

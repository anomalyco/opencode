import { notifySessionTabsRemoved } from "@/components/titlebar-session-events"
import type { ServerConnection } from "@/context/server"
import type { SessionInfo } from "@opencode-ai/client/promise"

type HomeSession = Pick<SessionInfo, "id" | "location">

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
        directory: input.session.location.directory,
        sessionIDs: [input.session.id],
      })
    })
    .catch((error) => input.onError?.(error))
}

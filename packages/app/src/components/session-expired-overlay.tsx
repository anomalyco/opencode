import { SessionExpiredOverlay as ForkSessionExpiredOverlay } from "@opencode-ai/fork-ui"
import { useSession } from "@/context/session"
import { useServer } from "@/context/server"

export function SessionExpiredOverlay() {
  const session = useSession()
  const server = useServer()
  return <ForkSessionExpiredOverlay isExpired={session.isExpired} getServerUrl={() => server.url} />
}

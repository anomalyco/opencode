import { SessionIndicator as ForkSessionIndicator } from "@opencode-ai/fork-ui"
import { useSession } from "@/context/session"
import { useServer } from "@/context/server"

export function SessionIndicator() {
  const session = useSession()
  const server = useServer()
  return <ForkSessionIndicator session={session} getServerUrl={() => server.url} />
}

import { DataProvider } from "@opencode-ai/session-ui/context"
import { useNavigate, useParams } from "@solidjs/router"
import { createMemo, type ParentProps } from "solid-js"
import { LocalProvider } from "@/context/local"
import type { ServerConnection } from "@/context/servers"
import { sessionHref } from "@/utils/session-route"
import { useData } from "@/context/server"

export function SessionUIProvider(
  props: ParentProps<{
    directory: string
    server: ServerConnection.Key
  }>,
) {
  const navigate = useNavigate()
  const params = useParams()
  const data = useData()
  const directory = () => props.directory
  const href = (sessionID: string) => sessionHref(props.server, sessionID)
  const navigateToSession = async (sessionID: string) => {
    await data.session.sync(sessionID).catch(() => undefined)
    navigate(href(sessionID))
  }
  const sessionUIData = createMemo(() => ({
    session: data.session.list(),
    session_status: Object.fromEntries(
      data.session
        .list()
        .map((session) => [
          session.id,
          data.session.status(session.id) === "running" ? ({ type: "busy" } as const) : ({ type: "idle" } as const),
        ]),
    ),
    session_diff: {},
  }))

  return (
    <DataProvider
      data={sessionUIData()}
      directory={directory()}
      sessionID={params.id}
      onNavigateToSession={navigateToSession}
      onSessionHref={href}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

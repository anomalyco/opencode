import { DataProvider } from "@opencode/session-ui/context"
import { MarkdownProvider, type ReadMarkdownImage } from "@opencode/session-ui/context/markdown"
import { useNavigate, useParams } from "@solidjs/router"
import { createMediaQuery } from "@solid-primitives/media"
import { createMemo, type ParentProps } from "solid-js"
import { useProviders } from "@/providers/catalog/providers"
import { LocalProvider } from "@/providers/models/selection"
import type { ServerConnection } from "@/runtime/server/registry"
import { sessionHref } from "@/shell/routes/session"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useTabs } from "@/shell/tabs/tabs"
import { readLocalImage } from "@/runtime/server/image"
import { useSessionLayout } from "@/session/session-layout"
import { sessionSubagentTab } from "@/shell/state/session-tabs"

export function SessionUIProvider(
  props: ParentProps<{
    directory: string
    server: ServerConnection.Key
  }>,
) {
  const navigate = useNavigate()
  const params = useParams()
  const data = useData()
  const serverSDK = useServerSDK()
  const tabs = useTabs()
  const layout = useSessionLayout()
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const directory = () => props.directory
  const readImage = createMemo<ReadMarkdownImage>(() => {
    const dir = directory()
    return (path, signal) => readLocalImage(serverSDK.api, dir, path, signal)
  })
  const href = (sessionID: string) => sessionHref(props.server, sessionID)
  const navigateToSession = async (sessionID: string) => {
    if (isDesktop()) {
      layout.view().reviewPanel.open()
      await layout.tabs().open(sessionSubagentTab(sessionID))
      void Promise.all([
        data.session.sync(sessionID).catch(() => undefined),
        data.session.message.sync(sessionID).catch(() => undefined),
      ])
      return
    }
    const tab = tabs.store.find(
      (item) =>
        item.type === "session" &&
        item.server === props.server &&
        (item.sessionId === params.id || item.routeSessionId === params.id),
    )
    if (tab?.type === "session") tabs.rememberSessionRoute(tab, sessionID, params.id)
    await data.session.sync(sessionID).catch(() => undefined)
    navigate(href(sessionID))
  }
  const providers = useProviders(directory)
  const sessionUIData = createMemo(() => ({
    provider: providers.ready()
      ? { all: providers.all(), default: providers.default(), connected: providers.connected().map((item) => item.id) }
      : undefined,
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
      shellRunning={(id) => !!data.shell.get(id)}
      shellOutput={(input) => serverSDK.api.shell.output(input)}
      onNavigateToSession={navigateToSession}
    >
      <MarkdownProvider readImage={readImage()}>
        <LocalProvider>{props.children}</LocalProvider>
      </MarkdownProvider>
    </DataProvider>
  )
}

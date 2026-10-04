import type { SessionID } from "@opencode/schema/session-id"
import { DataProvider } from "@opencode/session-ui/context"
import { MarkdownProvider, type ReadMarkdownImage } from "@opencode/session-ui/context/markdown"
import { useNavigate } from "@solidjs/router"
import { createMemo, type ParentProps } from "solid-js"
import { useProviders } from "@/providers/catalog/providers"
import { LocalProvider } from "@/providers/models/selection"
import type { ServerConnection } from "@/runtime/server/registry"
import { useSessionParams, sessionHref } from "@/shell/routes/session"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useTabs } from "@/shell/tabs/tabs"
import { readLocalImage } from "@/runtime/server/image"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"

export function SessionUIProvider(
  props: ParentProps<{
    directory: string
    server: ServerConnection.Key
  }>,
) {
  const navigate = useNavigate()
  const params = useSessionParams()
  const data = useData()
  const serverSDK = useServerSDK()
  const tabs = useTabs()
  const language = useLanguage()
  const directory = () => props.directory
  const readImage = createMemo<ReadMarkdownImage>(() => {
    const dir = directory()
    return (path, signal) => readLocalImage(serverSDK.api, dir, path, signal)
  })
  const href = (sessionID: SessionID) => sessionHref(props.server, sessionID)
  const navigateToSession = async (sessionID: SessionID) => {
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
  const openReferencedSession = async (sessionID: SessionID) => {
    // The transcript may mention a session from another server (or one that was deleted).
    // Resolve it on this server before touching tabs or the current route.
    const session = await serverSDK.api.session.get({ sessionID }).catch(() => undefined)
    if (!session || session.time.archived) {
      showToast({ title: language.t("session.error.notFound") })
      return
    }
    data.session.remember(session)
    tabs.select(tabs.addSessionTab({ server: props.server, sessionId: session.id }))
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
      onSessionHref={href}
    >
      <MarkdownProvider readImage={readImage()} openSession={openReferencedSession}>
        <LocalProvider>{props.children}</LocalProvider>
      </MarkdownProvider>
    </DataProvider>
  )
}

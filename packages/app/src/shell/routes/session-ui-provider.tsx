import { DataProvider } from "@opencode/session-ui/context"
import { MarkdownProvider, type ReadMarkdownImage } from "@opencode/session-ui/context/markdown"
import { useNavigate, useParams } from "@solidjs/router"
import { useQuery } from "@tanstack/solid-query"
import { createMemo, onCleanup, type ParentProps } from "solid-js"
import { useProviders } from "@/providers/catalog/providers"
import { LocalProvider } from "@/providers/models/selection"
import type { ServerConnection } from "@/runtime/server/registry"
import { sessionHref } from "@/shell/routes/session"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useTabs, type Tab } from "@/shell/tabs/tabs"
import { readLocalImage } from "@/runtime/server/image"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { createTurnDiffCache } from "@/session/timeline/turn-diffs"
import { useSettings } from "@/settings/model"

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
  const language = useLanguage()
  const settings = useSettings()
  const directory = () => props.directory

  const readImage = createMemo<ReadMarkdownImage>(() => {
    const dir = directory()

    return (path, signal) => readLocalImage(serverSDK.api, dir, path, signal)
  })

  const href = (sessionID: string) => sessionHref(props.server, sessionID)

  const navigateToSession = async (sessionID: string) => {
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

  const openReferencedSession = async (sessionID: string) => {
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

  const sessionTitle = (id: string) => {
    const session = data.session.get(id)

    return session && !session.time.archived ? session.title || language.t("command.session.new") : undefined
  }

  const providers = useProviders(directory)

  const config = useQuery(() => ({
    queryKey: [serverSDK.scope, "session-ui-config", directory()],
    enabled: serverSDK.connection.status() === "connected",
    queryFn: () => serverSDK.api.config.get({ location: { directory: directory() } }),
  }))

  onCleanup(
    serverSDK.event.on("config.updated", (event) => {
      if (event.location && event.location.directory !== directory()) return
      void config.refetch()
    }),
  )

  // Matches the server: the highest-priority document that sets `experimental` decides.
  const backgroundCompaction = () =>
    config.data
      ?.flatMap((entry) => (entry.type === "document" && entry.info.experimental ? [entry.info.experimental] : []))
      .at(-1)?.background_compaction === true

  // Turn diffs live in the tab's in-memory state, so they outlast timeline remounts and go when the tab closes.
  const turnDiffs = () => {
    const id = params.id

    if (!id) return

    const tab =
      tabs.store.find(
        (item) =>
          item.type === "session" &&
          item.server === props.server &&
          (item.sessionId === id || item.routeSessionId === id),
      ) ?? ({ type: "session", server: props.server, sessionId: id } satisfies Tab)

    return tabs.state(tab, "turnDiffs", createTurnDiffCache)
  }

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
    <LocalProvider>
      <DataProvider
        data={sessionUIData()}
        directory={directory()}
        sessionID={params.id}
        agents={settings.visibility.customAgents()}
        shellRunning={(id) => !!data.shell.get(id)}
        shellOutput={(input) => serverSDK.api.shell.output(input)}
        turnDiff={{
          get: (input) => turnDiffs()?.get(input),
          load: (input) => turnDiffs()?.load(input, () => serverSDK.api.session.diff(input)),
        }}
        onNavigateToSession={navigateToSession}
        onSessionHref={href}
        backgroundCompaction={backgroundCompaction()}
      >
        <MarkdownProvider readImage={readImage()} openSession={openReferencedSession} sessionTitle={sessionTitle}>
          {props.children}
        </MarkdownProvider>
      </DataProvider>
    </LocalProvider>
  )
}

import type { SessionMessageInfo } from "@opencode/client/promise"
import { DataProvider, type ReadToolFilesFn, type TurnDiffInput } from "@opencode/session-ui/context"
import { MarkdownProvider, type ReadMarkdownImage } from "@opencode/session-ui/context/markdown"
import { useNavigate, useParams } from "@solidjs/router"
import { useQuery } from "@tanstack/solid-query"
import { createMemo, onCleanup, untrack, type ParentProps } from "solid-js"
import { useProviders } from "@/providers/catalog/providers"
import { LocalProvider } from "@/providers/models/selection"
import type { ServerConnection } from "@/runtime/server/registry"
import { sessionHref } from "@/shell/routes/session"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { findSessionTab, useTabs } from "@/shell/tabs/tabs"
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

  // The message store drops the bytes of files in tool results; an expanded tool row reads its own back on demand.
  const readToolFiles: ReadToolFilesFn = async (input, signal) => {
    const owns = (message: SessionMessageInfo) =>
      message.type === "assistant" && message.content.some((part) => part.type === "tool" && part.id === input.toolID)

    const message = data.session.message.list(input.sessionID).find(owns)

    if (!message) return undefined

    const loaded = await serverSDK.api.session.message.get(
      { sessionID: input.sessionID, messageID: message.id },
      { signal },
    )

    if (loaded.type !== "assistant") return undefined
    const tool = loaded.content.find((part) => part.type === "tool" && part.id === input.toolID)

    if (tool?.type !== "tool" || !("content" in tool.state) || !tool.state.content) return undefined

    return tool.state.content.filter((item) => item.type === "file")
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

  // Turn diffs live in the routed tab's in-memory state, so they outlast timeline remounts and go when the tab closes.
  // A cached timeline keeps the source it had while routed, so a child keeps its tab's diffs after the tab returns to
  // the parent. A route without an open tab, such as one whose tab is closing, loads into a loose cache rather than
  // tab state nothing would remove.
  const looseTurnDiffs = createTurnDiffCache()

  const turnDiffCache = createMemo(() => {
    const tab = params.id ? findSessionTab(tabs.store, props.server, params.id) : undefined

    return tab ? untrack(() => tabs.state(tab, "turnDiffs", createTurnDiffCache)) : looseTurnDiffs
  })

  const turnDiff = createMemo(() => {
    const cache = turnDiffCache()

    return {
      get: cache.get,
      load: (input: TurnDiffInput) => cache.load(input, () => serverSDK.api.session.diff(input)),
    }
  })

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
        readMedia={(uri, mime, signal) => serverSDK.media.load(uri, mime, signal)}
        peekMedia={(uri, mime) => serverSDK.media.peek(uri, mime)}
        readToolFiles={readToolFiles}
        turnDiff={turnDiff()}
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

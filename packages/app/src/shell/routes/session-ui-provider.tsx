import { DataProvider, type TurnDiffInput } from "@opencode/session-ui/context"
import { MarkdownProvider, type ReadMarkdownImage } from "@opencode/session-ui/context/markdown"
import { useNavigate, useParams } from "@solidjs/router"
import { useQuery } from "@tanstack/solid-query"
import { createEffect, createMemo, createSignal, on, onCleanup, untrack, type ParentProps } from "solid-js"
import { useProviders } from "@/providers/catalog/providers"
import { LocalProvider } from "@/providers/models/selection"
import type { ServerConnection } from "@/runtime/server/registry"
import { sessionHref } from "@/shell/routes/session"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError, isSessionNotFoundError } from "@/runtime/server/errors"
import { findSessionTab, useTabs } from "@/shell/tabs/tabs"
import { readLocalImage } from "@/runtime/server/image"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { SessionExportProvider } from "@/session/commands/export-session"
import { createTurnDiffCache } from "@/session/timeline/turn-diffs"
import { SessionReferenceMenu, type SessionReferenceMenuTarget } from "@/session/session-reference-menu"
import { useSettings } from "@/settings/model"
import {
  INITIAL_SESSION_UI_NAVIGATE_STATE,
  transitionSessionUINavigate,
  type SessionNavigateOrigin,
  type SessionUINavigateEffect,
  type SessionUINavigateEvent,
} from "./session-ui-navigate-machine"
import {
  createSessionReferenceLookupState,
  transitionSessionReferenceLookup,
  type SessionReferenceLookupEffect,
  type SessionReferenceLookupEvent,
} from "./session-reference-lookup-machine"

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
  const releaseChannel = import.meta.env.VITE_OPENCODE_CHANNEL ?? "local"
  const copyAlwaysVisible = releaseChannel === "dev" || releaseChannel === "local"

  const readImage = createMemo<ReadMarkdownImage>(() => {
    const dir = directory()

    return (path, signal) => readLocalImage(serverSDK.api, dir, path, signal)
  })

  const href = (sessionID: string) => sessionHref(props.server, sessionID)

  const origin = (): SessionNavigateOrigin => ({ server: props.server, sessionID: params.id })
  const [navigation, setNavigation] = createSignal(INITIAL_SESSION_UI_NAVIGATE_STATE)
  const lookups = new Map<number, AbortController>()

  const dispatchNavigation = (event: SessionUINavigateEvent) => {
    const previous = untrack(navigation)
    const next = transitionSessionUINavigate(previous, event)

    if (next.state !== previous) setNavigation(next.state)
    next.effects.forEach((effect) =>
      Promise.try(() => runNavigation(effect)).catch((cause: unknown) => console.error("[session.navigate]", cause)),
    )
  }

  function runNavigation(effect: SessionUINavigateEffect) {
    if (effect.type === "child.sync") {
      const settled = () => dispatchNavigation({ type: "child.synced", attempt: effect.attempt })
      void Promise.try(() => data.session.sync(effect.targetSessionID)).then(settled, settled)

      return
    }

    if (effect.type === "child.navigate") {
      // The tab remembers the child only when the screen goes there, so it never disagrees with the route.
      const tab = effect.origin.sessionID ? tabs.sessionTab(effect.origin.server, effect.origin.sessionID) : undefined

      if (tab?.type === "session") tabs.rememberSessionRoute(tab, effect.targetSessionID, effect.origin.sessionID)
      navigate(sessionHref(effect.origin.server, effect.targetSessionID))

      return
    }

    if (effect.type === "referenced.lookup") {
      // The transcript may mention a session from another server (or one that was deleted).
      // Resolve it on this server before touching tabs or the current route.
      const controller = new AbortController()
      lookups.set(effect.attempt, controller)
      void Promise.try(() =>
        serverSDK.api.session.get({ sessionID: effect.targetSessionID }, { signal: controller.signal }),
      )
        .finally(() => lookups.delete(effect.attempt))
        .then(
          (session) =>
            dispatchNavigation(
              session.time.archived
                ? { type: "referenced.missing", attempt: effect.attempt }
                : { type: "referenced.resolved", attempt: effect.attempt, session },
            ),
          (cause: unknown) =>
            dispatchNavigation(
              isSessionNotFoundError(cause, effect.targetSessionID)
                ? { type: "referenced.missing", attempt: effect.attempt }
                : { type: "referenced.failed", attempt: effect.attempt, cause },
            ),
        )

      return
    }

    if (effect.type === "referenced.abort") {
      lookups.get(effect.attempt)?.abort()
      lookups.delete(effect.attempt)

      return
    }

    if (effect.type === "referenced.open") {
      data.session.remember(effect.session)
      tabs.select(tabs.addSessionTab({ server: effect.server, sessionId: effect.session.id }))

      return
    }

    if (effect.type === "toast.not-found") return showToast({ title: language.t("session.error.notFound") })

    showToast({ title: formatServerError(effect.cause, language.t, language.t("common.requestFailed")) })
  }

  createEffect(
    on(origin, (current) => dispatchNavigation({ type: "origin.changed", origin: current }), { defer: true }),
  )
  onCleanup(() => dispatchNavigation({ type: "disposed" }))

  const navigateToSession = (sessionID: string) =>
    dispatchNavigation({ type: "child.requested", origin: untrack(origin), targetSessionID: sessionID })

  const openReferencedSession = (sessionID: string) =>
    dispatchNavigation({ type: "referenced.requested", origin: untrack(origin), targetSessionID: sessionID })

  let referenceLookup = createSessionReferenceLookupState()
  const referenceLookups = new Map<number, AbortController>()

  const dispatchReferenceLookup = (event: SessionReferenceLookupEvent) => {
    const next = transitionSessionReferenceLookup(referenceLookup, event)

    referenceLookup = next.state
    next.effects.forEach((effect) =>
      Promise.try(() => runReferenceLookup(effect)).catch((cause: unknown) =>
        console.error("[session.reference]", cause),
      ),
    )
  }

  function runReferenceLookup(effect: SessionReferenceLookupEffect) {
    if (effect.type === "abort-all") {
      referenceLookups.forEach((controller) => controller.abort())
      referenceLookups.clear()

      return
    }

    if (effect.type === "remember") return data.session.remember(effect.session)
    const controller = new AbortController()
    referenceLookups.set(effect.attempt, controller)
    void Promise.try(() => serverSDK.api.session.get({ sessionID: effect.sessionID }, { signal: controller.signal }))
      .finally(() => referenceLookups.delete(effect.attempt))
      .then(
        (session) =>
          dispatchReferenceLookup({ type: "resolved", sessionID: effect.sessionID, attempt: effect.attempt, session }),
        () => dispatchReferenceLookup({ type: "unavailable", sessionID: effect.sessionID, attempt: effect.attempt }),
      )
  }

  createEffect(on(() => props.server, () => dispatchReferenceLookup({ type: "server.changed" }), { defer: true }))
  onCleanup(() => dispatchReferenceLookup({ type: "disposed" }))

  const sessionTitle = (id: string) => {
    if (id === params.id) return
    const session = data.session.get(id)

    // Markdown calls this inside its render effect.
    if (!session) untrack(() => dispatchReferenceLookup({ type: "requested", sessionID: id }))

    return session && !session.time.archived ? session.title || language.t("command.session.new") : undefined
  }

  const [referenceMenu, setReferenceMenu] = createSignal<SessionReferenceMenuTarget>()

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
      state: cache.state,
      load: (input: TurnDiffInput) => cache.load(input, (signal) => serverSDK.api.session.diff(input, { signal })),
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
        copyAlwaysVisible={copyAlwaysVisible}
        shellRunning={(id) => !!data.shell.get(id)}
        shellOutput={(input) => serverSDK.api.shell.output(input)}
        readMedia={(uri, mime, signal) => serverSDK.media.load(uri, mime, signal)}
        peekMedia={(uri, mime) => serverSDK.media.peek(uri, mime)}
        turnDiff={turnDiff()}
        onNavigateToSession={navigateToSession}
        onSessionHref={href}
        backgroundCompaction={backgroundCompaction()}
      >
        <MarkdownProvider
          readImage={readImage()}
          openSession={openReferencedSession}
          sessionTitle={sessionTitle}
          sessionMenu={(target) => setReferenceMenu({ ...target })}
        >
          <SessionExportProvider>{props.children}</SessionExportProvider>
          <SessionReferenceMenu
            target={referenceMenu()}
            currentSessionID={params.id}
            onOpenSession={openReferencedSession}
            onClose={() => setReferenceMenu(undefined)}
          />
        </MarkdownProvider>
      </DataProvider>
    </LocalProvider>
  )
}

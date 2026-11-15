import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { Schema } from "effect"
import { isSessionNotFoundError, type SessionInfo } from "@opencode/client/promise"
import type { ServerSDK } from "@/runtime/server/client"
import type { Data } from "@opencode/client/solid"
import { usePlatform } from "@/runtime/platform/platform"
import { useLanguage } from "@/runtime/i18n/language"
import { projectSettingsKey, useSettings } from "@/settings/model"
import { Persist, persisted, removePersisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { playSoundById } from "@/shell/notifications/sound"
import type { createNotificationCoordinator } from "@/shell/notifications/coordinator"
import { ServerConnection } from "@/runtime/server/registry"
import { sessionIDHasOpenTab, useTabs } from "@/shell/tabs/tabs"
import { useServer } from "@/runtime/server/current"
import {
  INITIAL_LEGACY_MIGRATION_STATE,
  INITIAL_VIEW_REPORT_STATE,
  isSessionUnread,
  selectLegacyHiddenReports,
  selectSessionUnread,
  transitionLegacyMigration,
  transitionViewReport,
  type LegacyMigrationEvent,
  type LegacyViewReport,
  type ViewReportEvent,
  type ViewReportState,
} from "@/shell/notifications/machine"

type NotificationTabs = Pick<ReturnType<typeof useTabs>, "addSessionTab" | "rememberSessionRoute" | "select">

const requestTitles = {
  permission: "notification.permission.title",
  question: "notification.question.title",
  "mcp-elicitation": "notification.elicitation.title",
  "websearch.provider": "notification.permission.title",
} as const

export function openNotificationSession(tabs: NotificationTabs, server: ServerConnection.Key, sessionID: string) {
  const tab = tabs.addSessionTab({ server, sessionId: sessionID })

  if (tab.type !== "session") return
  tabs.rememberSessionRoute(tab, sessionID)
  tabs.select(tab)
}

// Only direct children: a grandchild reports to its own parent, so waiting on it could mean no sound at all. Running
// shells don't count, or a session with a dev server running would never play one.
function hasRunningChild(data: Data, sessionID: string) {
  return data.session
    .family(sessionID)
    .some(
      (child) =>
        child !== sessionID &&
        data.session.get(child)?.parentID === sessionID &&
        data.session.status(child) === "running",
    )
}

// The list Desktop kept before unread state moved to the server. Until its viewed state reaches the server, unread
// state still honours it, so sessions read here don't light up while the server catches up.
const LegacyNotificationStore = Persistence.struct({
  list: Schema.optional(
    Persistence.array(Persistence.struct({ session: Schema.optional(Schema.String), viewed: Schema.Boolean })),
  ),
  // When this client first found the list. Sessions that went idle later are new, whatever the list says.
  started: Schema.optional(Schema.Finite),
})

const LEGACY_MIGRATION_PAGE = 200

const LEGACY_MIGRATION_CONCURRENCY = 4

// Manual unread is client-local: the server's viewed watermark can only move forwards.
const ManualUnreadStore = Persistence.struct({ sessions: Persistence.array(Schema.String) })

export function createServerNotificationState(input: {
  sdk: ServerSDK
  data: Data
  key: ServerConnection.Key
  coordinator: ReturnType<typeof createNotificationCoordinator>
  muted: (sessionID: string) => boolean
  preferencesLoaded?: Promise<unknown>
}) {
  const platform = usePlatform()
  const settings = useSettings()
  const language = useLanguage()
  const tabs = useTabs()
  const disposed = { value: false }
  const connected = createMemo(() => input.sdk.connection.status() === "connected")

  // Per root session, so a failed report retries on its own whether or not a reactive caller is still viewing it.
  const reports = new Map<string, ViewReportState>()
  const reportTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const dispatchView = (root: string, event: ViewReportEvent) => {
    const result = transitionViewReport(reports.get(root) ?? INITIAL_VIEW_REPORT_STATE, event)

    reports.set(root, result.state)
    result.effects.forEach((effect) => {
      if (effect.type === "forget") {
        input.data.session.forget(root)

        return
      }

      clearTimeout(reportTimers.get(root))
      reportTimers.delete(root)

      if (effect.type === "send.cancel") return

      if (effect.delayMs === 0) {
        sendView(root, effect)

        return
      }

      reportTimers.set(
        root,
        setTimeout(() => {
          reportTimers.delete(root)
          sendView(root, effect)
        }, effect.delayMs),
      )
    })
  }

  const sendView = (root: string, effect: { idle: number; attempt: number }) =>
    void input.sdk.api.session.view({ sessionID: root, idle: effect.idle }).then(
      () => dispatchView(root, { type: "report.succeeded", attempt: effect.attempt }),
      (error) =>
        dispatchView(root, { type: "report.failed", attempt: effect.attempt, notFound: isSessionNotFoundError(error) }),
    )

  const legacyTarget = Persist.serverGlobal(input.sdk.scope, "notification")
  const [legacy, setLegacy, , legacyReady] = persisted(legacyTarget, LegacyNotificationStore, {}, platform)

  const [manual, setManual, , manualReady] = persisted(
    Persist.serverGlobal(input.sdk.scope, "notification.manual-unread"),
    ManualUnreadStore,
    { sessions: [] },
    platform,
  )

  const manuallyUnread = createMemo(() => new Set(manual.sessions))
  const [legacyState, setLegacyState] = createSignal(INITIAL_LEGACY_MIGRATION_STATE)
  const discovered = Date.now()
  let legacyRun: AbortController | undefined

  const dispatchLegacy = (event: LegacyMigrationEvent) => {
    const previous = untrack(legacyState)
    const result = transitionLegacyMigration(previous, event)

    if (result.state !== previous) setLegacyState(result.state)
    result.effects.forEach((effect) => {
      if (effect.type === "persist.started") {
        setLegacy("started", effect.started)

        return
      }

      if (effect.type === "persist.remove") {
        removePersisted(legacyTarget, platform)

        return
      }

      legacyRun?.abort()
      legacyRun = undefined

      if (effect.type === "run.cancel") return

      const controller = new AbortController()

      const timer = setTimeout(
        () =>
          void migrateLegacy(controller.signal).then(
            () => dispatchLegacy({ type: "run.succeeded", attempt: effect.attempt }),
            () => dispatchLegacy({ type: "run.failed", attempt: effect.attempt }),
          ),
        effect.delayMs,
      )

      controller.signal.addEventListener("abort", () => clearTimeout(timer))
      legacyRun = controller
    })
  }

  // Carry the old list's viewed state to the server in the background: page through every root session and report
  // the ones the server has unread but this client shows read. Then delete the list. Reports already made are
  // skipped on a retry because the server then has them read.
  const migrateLegacy = async (signal: AbortSignal) => {
    let cursor: string | undefined

    for (;;) {
      const page = await input.sdk.api.session.list({
        limit: LEGACY_MIGRATION_PAGE,
        order: "desc",
        parentID: null,
        cursor,
      })

      const hidden = selectLegacyHiddenReports(untrack(legacyState), page.data)
      const settled: PromiseSettledResult<LegacyViewReport>[] = []

      for (let index = 0; index < hidden.length; index += LEGACY_MIGRATION_CONCURRENCY) {
        if (signal.aborted || settled.some((result) => result.status === "rejected")) break

        settled.push(
          ...(await Promise.allSettled(
            hidden
              .slice(index, index + LEGACY_MIGRATION_CONCURRENCY)
              .map((report) => input.sdk.api.session.view(report).then(() => report)),
          )),
        )
      }

      dispatchLegacy({
        type: "sessions.reported",
        reports: settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
      })

      const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected")

      if (failure) throw failure.reason

      if (signal.aborted || page.data.length === 0 || !page.cursor.next) return
      cursor = page.cursor.next
    }
  }

  const hydrateLegacy = () =>
    untrack(() =>
      dispatchLegacy({
        type: "hydrated",
        list: legacy.list,
        started: legacy.started,
        now: discovered,
        connected: connected(),
      }),
    )

  // localStorage reads the old list at once; hydrate now so unread state is right before the first effect runs.
  if (untrack(legacyReady)) hydrateLegacy()

  createEffect(() => {
    if (legacyReady()) hydrateLegacy()
  })

  createEffect(() => {
    const online = connected()

    dispatchLegacy({ type: "connection.changed", connected: online })

    if (online) reports.forEach((_, root) => dispatchView(root, { type: "connected" }))
  })

  const unread = (session?: Pick<SessionInfo, "id" | "time">) =>
    (!!session && manuallyUnread().has(session.id)) || selectSessionUnread(legacyState(), session)

  const updateManual = (sessionID: string, unread: boolean) => {
    const apply = () => {
      if (disposed.value || manuallyUnread().has(sessionID) === unread) return
      setManual("sessions", (sessions) =>
        unread ? [...sessions, sessionID] : sessions.filter((id) => id !== sessionID),
      )
    }

    if (manualReady()) return apply()
    void manualReady.promise?.then(apply, apply)
  }

  const roots = (directory: string) =>
    input.data.session
      .list()
      .filter(
        (session) =>
          !session.parentID && session.time.archived === undefined && session.location.directory === directory,
      )

  const view = (sessionID: string) => {
    const root = input.data.session.root(sessionID)
    const session = input.data.session.get(root)
    const idle = session?.time.idle

    if (idle === undefined || !isSessionUnread(session)) return
    dispatchView(root, { type: "view", idle })
  }

  const opened = (sessionID: string) => updateManual(input.data.session.root(sessionID), false)

  const read = (sessionID: string) => {
    opened(sessionID)
    view(sessionID)
  }

  // Loading the session keeps a background completion visible in the server-derived unread state.
  const lookup = async (sessionID: string) => {
    if (input.preferencesLoaded) await input.preferencesLoaded
    const session = input.data.session.get(sessionID)

    if (session) return session

    return input.data.session
      .sync(sessionID)
      .then(() => input.data.session.get(sessionID))
      .catch(() => undefined)
  }

  const handleSessionIdle = (sessionID: string, eventID: string) => {
    // A running subagent's report wakes the session again, so it isn't done yet.
    if (hasRunningChild(input.data, sessionID)) return

    void lookup(sessionID).then((session) => {
      if (disposed.value || input.muted(sessionID)) return

      if (!session) return

      if (session.parentID) return

      const hasOpenTab = sessionIDHasOpenTab(tabs.store, input.key, sessionID)

      if (hasOpenTab && settings.sounds.agentEnabled()) {
        void input.coordinator.sound(`${input.key}\0${eventID}`, () => playSoundById(settings.sounds.agent()))
      }

      if (hasOpenTab && settings.notifications.agent()) {
        void input.coordinator.system(`${input.key}\0${eventID}`, () =>
          platform.notify(language.t("notification.session.responseReady.title"), session.title ?? sessionID, () =>
            openNotificationSession(tabs, input.key, sessionID),
          ),
        )
      }
    })
  }

  const handleSessionError = (sessionID: string, eventID: string) => {
    void lookup(sessionID).then((session) => {
      if (disposed.value || input.muted(sessionID)) return

      if (session?.parentID) return

      const hasOpenTab = sessionIDHasOpenTab(tabs.store, input.key, sessionID)

      if (hasOpenTab && settings.sounds.errorsEnabled()) {
        void input.coordinator.sound(`${input.key}\0${eventID}`, () => playSoundById(settings.sounds.errors()))
      }

      const description = session?.title ?? language.t("notification.session.error.fallbackDescription")

      if (hasOpenTab && settings.notifications.errors()) {
        void input.coordinator.system(`${input.key}\0${eventID}`, () =>
          platform.notify(language.t("notification.session.error.title"), description, () =>
            openNotificationSession(tabs, input.key, sessionID),
          ),
        )
      }
    })
  }

  const handleRequest = async (kind: keyof typeof requestTitles, sessionID: string, requestID: string) => {
    const session = await lookup(sessionID)

    if (!session || disposed.value) return

    const target = sessionIDHasOpenTab(tabs.store, input.key, sessionID)
      ? sessionID
      : input.data.session.root(sessionID)

    if (!sessionIDHasOpenTab(tabs.store, input.key, target)) return

    const category = kind === "question" || kind === "mcp-elicitation" ? "questions" : "permissions"

    const pending = () => {
      if (disposed.value || input.muted(sessionID) || input.muted(input.data.session.root(sessionID))) return false

      if (kind !== "permission") return input.data.session.form.list(sessionID)?.some((form) => form.id === requestID)

      if (settings.permissions.autoApproves(projectSettingsKey(input.sdk.scope, session.projectID))) return false

      return input.data.session.permission.list(sessionID)?.some((request) => request.id === requestID)
    }

    if (!pending()) return

    const key = `${input.key}\0${kind}:${requestID}`

    if (settings.sounds[`${category}Enabled`]()) {
      void input.coordinator.sound(key, () => {
        if (pending()) return playSoundById(settings.sounds[category]())
      })
    }

    if (!settings.notifications[category]()) return

    void input.coordinator.system(key, () => {
      if (!pending()) return

      return platform.notify(language.t(requestTitles[kind]), session.title ?? sessionID, () =>
        openNotificationSession(tabs, input.key, target),
      )
    })
  }

  const unsub = input.sdk.event.listen((event) => {
    if (event.type === "session.deleted") {
      updateManual(event.data.sessionID, false)

      return
    }

    if (event.type === "permission.asked") {
      void handleRequest("permission", event.data.sessionID, event.data.id)

      return
    }

    if (event.type === "form.created") {
      const kind = event.data.form.metadata?.kind

      if (kind === "question" || kind === "mcp-elicitation" || kind === "websearch.provider") {
        void handleRequest(kind, event.data.form.sessionID, event.data.form.id)
      }

      return
    }

    if (event.type === "session.execution.failed") {
      handleSessionError(event.data.sessionID, event.id)

      return
    }

    if (event.type === "session.execution.succeeded") handleSessionIdle(event.data.sessionID, event.id)
  })

  onCleanup(() => {
    disposed.value = true
    unsub()
    dispatchLegacy({ type: "disposed" })
    reports.forEach((_, root) => dispatchView(root, { type: "disposed" }))
  })

  return {
    session: {
      ready: manualReady,
      /**
       * Whether the session's root has an execution result no client has viewed yet. `snapshot` stands in for a root
       * session that isn't loaded, such as a row from the fetched home index.
       */
      unread(sessionID: string, snapshot?: SessionInfo) {
        return unread(input.data.session.get(input.data.session.root(sessionID)) ?? snapshot)
      },
      manuallyUnread(sessionID: string) {
        return manuallyUnread().has(input.data.session.root(sessionID))
      },
      /** Reports the session's latest idle transition to the server as viewed. */
      markViewed: view,
      opened,
      markRead: read,
      markUnread(sessionID: string) {
        updateManual(input.data.session.root(sessionID), true)
      },
    },
    project: {
      hasUnread(directory: string) {
        return roots(directory).some((session) => unread(session))
      },
      markViewed(directory: string) {
        roots(directory).forEach((session) => read(session.id))
      },
    },
  }
}

export const useNotification = () => {
  const server = useServer()

  return server.ctx.notification
}

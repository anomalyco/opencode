import { createEffect, createMemo, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
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

/** A session is unread when its latest terminal execution is newer than the last one any client viewed. */
function isSessionUnread(session?: Pick<SessionInfo, "time">) {
  const time = session?.time

  return time?.idle !== undefined && (time.viewed === undefined || time.idle > time.viewed)
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

// The carry-over waits this long after connecting so it doesn't compete with startup requests.
const LEGACY_MIGRATION_DELAY = 5_000

const LEGACY_MIGRATION_PAGE = 200

const LEGACY_MIGRATION_CONCURRENCY = 4

const VIEW_RETRY_DELAY = 250

const VIEW_RETRY_MAX_DELAY = 5_000

export function createServerNotificationState(input: {
  sdk: ServerSDK
  data: Data
  key: ServerConnection.Key
  coordinator: ReturnType<typeof createNotificationCoordinator>
}) {
  const platform = usePlatform()
  const settings = useSettings()
  const language = useLanguage()
  const tabs = useTabs()
  const disposed = { value: false }
  // Idle watermarks already reported per root session, so reactive re-runs don't re-post them.
  const acknowledged = new Map<string, number>()
  // A failed view report re-runs the tracking caller with backoff, like the TUI.
  const [state, setState] = createStore({ viewRetry: 0, legacyMigrated: false })
  let viewRetryTimer: ReturnType<typeof setTimeout> | undefined
  let viewRetryAttempt = 0
  onCleanup(() => clearTimeout(viewRetryTimer))

  const legacyTarget = Persist.serverGlobal(input.sdk.scope, "notification")
  const [legacy, setLegacy, , legacyReady] = persisted(legacyTarget, LegacyNotificationStore, {}, platform)
  const started = Date.now()
  const legacyStarted = () => legacy.started ?? started

  // Sessions the old list still had unread, while its viewed state hasn't reached the server yet.
  const legacyUnseen = createMemo(() => {
    const list = legacy.list

    if (!list || state.legacyMigrated) return

    return new Set(list.flatMap((item) => (!item.viewed && item.session ? [item.session] : [])))
  })

  // Idle watermarks the carry-over reported, so rows drawn from an older fetched copy of a session stay read.
  const legacyReported = new Map<string, number>()

  const unread = (session?: Pick<SessionInfo, "id" | "time">) => {
    const idle = session?.time.idle

    // Until the old list is read, a session it had read could flash unread.
    if (!legacyReady() || !session || idle === undefined || !isSessionUnread(session)) return false

    if (idle <= (legacyReported.get(session.id) ?? -Infinity)) return false
    const unseen = legacyUnseen()

    return !unseen || unseen.has(session.id) || idle > legacyStarted()
  }

  // Carry the old list's viewed state to the server in the background: page through every root session and report
  // the ones the server has unread but this client shows read. Then delete the list. A failure keeps it, and the
  // next connection retries; reports already made are skipped because the server then has them read.
  let legacyMigration: "idle" | "scheduled" | "running" = "idle"

  const migrateLegacy = async () => {
    legacyMigration = "running"
    let cursor: string | undefined

    for (;;) {
      const page = await input.sdk.api.session.list({
        limit: LEGACY_MIGRATION_PAGE,
        order: "desc",
        parentID: null,
        cursor,
      })

      const hidden = page.data.flatMap((session) =>
        session.time.idle !== undefined && isSessionUnread(session) && !unread(session)
          ? [{ sessionID: session.id, idle: session.time.idle }]
          : [],
      )

      for (let index = 0; index < hidden.length; index += LEGACY_MIGRATION_CONCURRENCY) {
        if (disposed.value) return

        await Promise.all(
          hidden.slice(index, index + LEGACY_MIGRATION_CONCURRENCY).map(async (report) => {
            await input.sdk.api.session.view(report)
            legacyReported.set(report.sessionID, report.idle)
          }),
        )
      }

      if (page.data.length === 0 || !page.cursor.next) break
      cursor = page.cursor.next
    }

    removePersisted(legacyTarget, platform)
    setState("legacyMigrated", true)
  }

  createEffect(() => {
    if (!legacyReady() || !legacyUnseen()) return

    if (untrack(() => legacy.started) === undefined) setLegacy("started", started)

    if (input.sdk.connection.status() !== "connected" || legacyMigration !== "idle") return
    legacyMigration = "scheduled"

    const timer = setTimeout(
      () =>
        void migrateLegacy().catch(() => {
          legacyMigration = "idle"
        }),
      LEGACY_MIGRATION_DELAY,
    )

    onCleanup(() => {
      clearTimeout(timer)

      if (legacyMigration === "scheduled") legacyMigration = "idle"
    })
  })

  const roots = (directory: string) =>
    input.data.session
      .list()
      .filter(
        (session) =>
          !session.parentID && session.time.archived === undefined && session.location.directory === directory,
      )

  const view = (sessionID: string) => {
    void state.viewRetry
    const root = input.data.session.root(sessionID)
    const session = input.data.session.get(root)
    const idle = session?.time.idle

    if (idle === undefined || !isSessionUnread(session) || acknowledged.get(root) === idle) return
    acknowledged.set(root, idle)
    void input.sdk.api.session.view({ sessionID: root, idle }).then(
      () => {
        clearTimeout(viewRetryTimer)
        viewRetryTimer = undefined
        viewRetryAttempt = 0
      },
      (error) => {
        if (isSessionNotFoundError(error)) {
          acknowledged.delete(root)
          input.data.session.forget(root)

          return
        }

        if (acknowledged.get(root) !== idle) return
        acknowledged.delete(root)

        if (viewRetryTimer) return

        const delay = Math.min(VIEW_RETRY_DELAY * 2 ** viewRetryAttempt, VIEW_RETRY_MAX_DELAY)
        viewRetryAttempt++
        viewRetryTimer = setTimeout(() => {
          viewRetryTimer = undefined
          setState("viewRetry", (value) => value + 1)
        }, delay)
      },
    )
  }

  // Loading the session keeps a background completion visible in the server-derived unread state.
  const lookup = async (sessionID: string) => {
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
      if (disposed.value) return

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
      if (disposed.value) return

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
      if (disposed.value) return false

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
  })

  return {
    session: {
      /**
       * Whether the session's root has an execution result no client has viewed yet. `snapshot` stands in for a root
       * session that isn't loaded, such as a row from the fetched home index.
       */
      unread(sessionID: string, snapshot?: SessionInfo) {
        return unread(input.data.session.get(input.data.session.root(sessionID)) ?? snapshot)
      },
      /** Reports the session's latest idle transition to the server as viewed. */
      markViewed: view,
    },
    project: {
      hasUnread(directory: string) {
        return roots(directory).some((session) => unread(session))
      },
      markViewed(directory: string) {
        roots(directory).forEach((session) => view(session.id))
      },
    },
  }
}

export const useNotification = () => {
  const server = useServer()

  return server.ctx.notification
}

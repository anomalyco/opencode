import { beforeAll, beforeEach, expect, mock, setSystemTime, test, vi } from "bun:test"
import { createEffect, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { OpenCodeEvent } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"
import { ServerScope } from "@/runtime/server/scope"
import type { Tab } from "@/shell/tabs/tabs"
import type { createNotificationCoordinator } from "@/shell/notifications/coordinator"

type NotificationDelivery = Parameters<ReturnType<typeof createNotificationCoordinator>["system"]>[1]

// SAFETY: this is the key format `ServerConnection.key` produces for a local server.
const server = "local\nhttp://localhost:4096" as ServerConnection.Key

const session = { id: "session-1", title: "Test session", location: { directory: "/project" } }

const alerts: string[] = []

const sounds: string[] = []

const clicks: Array<() => void> = []

const selected: string[] = []

const tabs = {
  store: new Array<Tab>(),
  addSessionTab: (input: { server: ServerConnection.Key; sessionId: string }) => ({
    type: "session" as const,
    ...input,
  }),
  rememberSessionRoute: () => {},
  select: (tab: Tab) => {
    if (tab.type === "session") selected.push(tab.sessionId)
  },
}

let createServerNotificationState: typeof import("@/shell/notifications/notification").createServerNotificationState

const preferences = {
  autoApprove: false,
  agent: true,
  permissions: true,
  questions: true,
  permissionsSound: true,
  questionsSound: true,
}

// Each test fakes only the parts of the SDK, data store and coordinator that the notification state reads.
const createState = (input: { sdk: object; data: object; coordinator: object }) =>
  // SAFETY: the fakes cover every member the notification state reaches in that test.
  createServerNotificationState({ key: server, ...input } as never)

beforeAll(async () => {
  // Fakes replace only the hooks this test controls. Spreading the real module keeps every other export, such as
  // projectSettingsKey, for the modules the notification state imports.
  const real = {
    platform: await import("@/runtime/platform/platform"),
    settings: await import("@/settings/model"),
    language: await import("@/runtime/i18n/language"),
    tabs: await import("@/shell/tabs/tabs"),
  }

  mock.module("@/runtime/platform/platform", () => ({
    ...real.platform,
    usePlatform: () => ({
      platform: "web",
      notify: async (title: string, _description?: string, onClick?: () => void) => {
        alerts.push(title)

        if (onClick) clicks.push(onClick)
      },
    }),
  }))
  mock.module("@/runtime/i18n/language", () => ({
    ...real.language,
    useLanguage: () => ({ t: (key: string) => key }),
  }))
  mock.module("@/settings/model", () => ({
    ...real.settings,
    useSettings: () => ({
      sounds: {
        agentEnabled: () => false,
        errorsEnabled: () => false,
        permissionsEnabled: () => preferences.permissionsSound,
        permissions: () => "alert-01",
        questionsEnabled: () => preferences.questionsSound,
        questions: () => "alert-02",
      },
      notifications: {
        agent: () => preferences.agent,
        errors: () => true,
        permissions: () => preferences.permissions,
        questions: () => preferences.questions,
      },
      permissions: { autoApproves: () => preferences.autoApprove },
    }),
  }))
  mock.module("@/shell/tabs/tabs", () => ({ ...real.tabs, useTabs: () => tabs }))
  mock.module("@/shell/notifications/sound", () => ({
    playSoundById: async (id: string) => {
      sounds.push(id)
    },
  }))
  createServerNotificationState = (await import("@/shell/notifications/notification")).createServerNotificationState
})

beforeEach(() => {
  alerts.length = 0
  sounds.length = 0
  clicks.length = 0
  selected.length = 0
  Object.assign(preferences, {
    autoApprove: false,
    agent: true,
    permissions: true,
    questions: true,
    permissionsSound: true,
    questionsSound: true,
  })
})

const requests = [
  { kind: "permission", category: "permissions", title: "notification.permission.title" },
  { kind: "question", category: "questions", title: "notification.question.title" },
  { kind: "mcp-elicitation", category: "questions", title: "notification.elicitation.title" },
  { kind: "websearch.provider", category: "permissions", title: "notification.permission.title" },
] as const

test.each(
  requests.flatMap((request) =>
    [
      "enabled",
      "other category disabled",
      "notifications disabled",
      "sound disabled",
      "resolved",
      "auto approve",
      "root tab",
      "no tab",
      "disposed",
    ].map((scenario) => ({ ...request, scenario })),
  ),
)("request alerts: $kind / $scenario", async (options) => {
  preferences.agent = false
  preferences.autoApprove = options.scenario === "auto approve"
  preferences[options.category] = options.scenario !== "notifications disabled"
  preferences[options.category === "questions" ? "questionsSound" : "permissionsSound"] =
    options.scenario !== "sound disabled"

  if (options.scenario === "other category disabled") {
    preferences[options.category === "questions" ? "permissions" : "questions"] = false
    preferences[options.category === "questions" ? "permissionsSound" : "questionsSound"] = false
  }

  tabs.store =
    options.scenario === "no tab"
      ? []
      : [{ type: "session", server, sessionId: options.scenario === "root tab" ? "root" : session.id }]
  const listeners = new Array<(event: OpenCodeEvent) => void>()

  const deliveries = new Array<NotificationDelivery>()

  const pending = { value: true }

  const dispose = createRoot((dispose) => {
    createState({
      sdk: {
        scope: ServerScope.local,
        event: {
          listen: (listener: (event: OpenCodeEvent) => void) => {
            listeners.push(listener)

            return () => {}
          },
        },
      },
      data: {
        session: {
          get: () => ({ ...session, parentID: "root", projectID: "project-1" }),
          root: () => "root",
          permission: { list: () => (pending.value ? [{ id: "request-1" }] : []) },
          form: { list: () => (pending.value ? [{ id: "request-1" }] : []) },
        },
      },
      coordinator: {
        sound: async (_key: string, run: NotificationDelivery) => {
          deliveries.push(run)
        },
        system: async (_key: string, run: NotificationDelivery) => {
          deliveries.push(run)
        },
      },
    })

    return dispose
  })

  try {
    const event: OpenCodeEvent =
      options.kind === "permission"
        ? {
            id: "event-1",
            created: 0,
            location: session.location,
            type: "permission.asked",
            data: { sessionID: session.id, id: "request-1", action: "shell", resources: [], metadata: {} },
          }
        : {
            id: "event-1",
            created: 0,
            location: session.location,
            type: "form.created",
            data: {
              form: {
                sessionID: session.id,
                id: "request-1",
                title: "Input",
                fields: [{ key: "answer", type: "string", title: "Continue?" }],
                metadata: { kind: options.kind },
              },
            },
          }

    listeners.forEach((listener) => listener(event))
    await Promise.resolve()

    if (options.scenario === "resolved") pending.value = false

    if (options.scenario === "disposed") dispose()
    await Promise.all(deliveries.map((run) => run()))

    const suppressed =
      ["resolved", "disposed", "no tab"].includes(options.scenario) ||
      (options.scenario === "auto approve" && options.kind === "permission")

    expect(alerts).toEqual(!suppressed && options.scenario !== "notifications disabled" ? [options.title] : [])
    expect(sounds).toEqual(
      !suppressed && options.scenario !== "sound disabled"
        ? [options.category === "questions" ? "alert-02" : "alert-01"]
        : [],
    )
    clicks.forEach((click) => click())
    expect(selected).toEqual(alerts.length ? [options.scenario === "root tab" ? "root" : session.id] : [])
  } finally {
    dispose()
  }
})

test.each([
  ["session.execution.succeeded", "notification.session.responseReady.title"],
  ["session.execution.failed", "notification.session.error.title"],
] as const)("system alert for %s requires an open session tab", async (type, title) => {
  alerts.length = 0
  tabs.store = [{ type: "session", server, sessionId: "another-session" }]
  const listeners = new Array<(event: OpenCodeEvent) => void>()

  const emit = (id: string) =>
    listeners.forEach((listener) =>
      // SAFETY: the notification state reads only the type, id and session of execution events.
      listener({ type, id, data: { sessionID: session.id, error: { type: "api", message: "failed" } } } as never),
    )

  const dispose = createRoot((dispose) => {
    createState({
      sdk: {
        scope: ServerScope.local,
        event: {
          listen: (listener: (event: OpenCodeEvent) => void) => {
            listeners.push(listener)

            return () => {}
          },
        },
      },
      data: { session: { get: () => session, family: () => [session.id], status: () => "idle" } },
      coordinator: { system: async (_id: string, fn: () => Promise<void>) => fn() },
    })

    return dispose
  })

  emit("event-1")
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(alerts).toEqual([])

  tabs.store = [{ type: "session", server, sessionId: session.id }]
  emit("event-2")
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(alerts).toEqual([title])
  dispose()
})

test("unread state and viewing follow the server's idle and viewed watermarks", async () => {
  const views: { sessionID: string; idle: number }[] = []
  const failures = { remaining: 1 }

  type Info = {
    id: string
    parentID?: string
    time: { idle?: number; viewed?: number; archived?: number }
    location: { directory: string }
  }

  const [store, setStore] = createStore<{ viewing?: string; sessions: Record<string, Info> }>({
    sessions: {
      root: { id: "root", time: { idle: 2, viewed: 1 }, location: { directory: "/project" } },
      child: { id: "child", parentID: "root", time: { idle: 5 }, location: { directory: "/project" } },
      read: { id: "read", time: { idle: 3, viewed: 3 }, location: { directory: "/project" } },
      archived: { id: "archived", time: { idle: 4, archived: 1 }, location: { directory: "/project" } },
      other: { id: "other", time: { idle: 4 }, location: { directory: "/other" } },
    },
  })

  const dispose = createRoot((dispose) => {
    const state = createState({
      sdk: {
        scope: ServerScope.local,
        event: { listen: () => () => {} },
        api: {
          session: {
            view: async (input: { sessionID: string; idle: number }) => {
              views.push(input)

              if (failures.remaining-- > 0) throw new Error("offline")
            },
          },
        },
      },
      data: {
        session: {
          get: (id: string) => store.sessions[id],
          root: (id: string) => store.sessions[id]?.parentID ?? id,
          list: () => Object.values(store.sessions),
        },
      },
      coordinator: {},
    })

    // Mirrors the session route, which re-runs markViewed whenever what it reads changes.
    createEffect(() => {
      if (store.viewing) state.session.markViewed(store.viewing)
    })

    return { dispose, state }
  })

  const state = dispose.state

  // Unread reads the root session; children and archived sessions never mark a project unread.
  expect(["root", "child", "read", "other"].map((id) => state.session.unread(id))).toEqual([true, true, false, true])
  expect(state.project.hasUnread("/project")).toBe(true)

  // Viewing a child acknowledges its root's idle watermark; a failed report retries after a backoff.
  setStore("viewing", "child")
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(views).toEqual([{ sessionID: "root", idle: 2 }])
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(views).toEqual([
    { sessionID: "root", idle: 2 },
    { sessionID: "root", idle: 2 },
  ])

  setStore("sessions", "root", "time", "viewed", 2)
  expect(state.session.unread("root")).toBe(false)
  expect(state.project.hasUnread("/project")).toBe(false)

  // A newer turn while the session stays open makes it unread and reports the new watermark once.
  setStore("sessions", "root", "time", "idle", 6)
  expect(state.session.unread("root")).toBe(true)
  state.project.markViewed("/project")
  state.project.markViewed("/other")
  expect(views.slice(2)).toEqual([
    { sessionID: "root", idle: 6 },
    { sessionID: "other", idle: 4 },
  ])
  dispose.dispose()
})

test("unread state honours the old local list until its viewed state is carried to the server, then deletes it", async () => {
  const key = "opencode.global.dat:notification"
  const lists: unknown[] = []
  const views: { sessionID: string; idle: number }[] = []
  const failures = { remaining: 1 }

  // The old list was found at time 10: sessions that went idle by then were read here unless the list says otherwise.
  vi.useFakeTimers()
  setSystemTime(new Date(10))
  localStorage.setItem(
    key,
    JSON.stringify({
      list: [
        { type: "turn-complete", time: 1, viewed: true, session: "read-here" },
        { type: "turn-complete", time: 2, viewed: false, session: "unread-here" },
      ],
    }),
  )

  const sessions = [
    { id: "read-here", time: { idle: 5 } },
    { id: "unread-here", time: { idle: 6 } },
    { id: "viewed", time: { idle: 4, viewed: 4 } },
    { id: "untracked", time: { idle: 7, viewed: 3 } },
    { id: "new", time: { idle: 20 } },
    { id: "never-ran", time: {} },
  ]

  const start = () =>
    createRoot((dispose) => ({
      dispose,
      state: createState({
        sdk: {
          scope: ServerScope.local,
          connection: { status: () => "connected" },
          event: { listen: () => () => {} },
          api: {
            session: {
              list: async (input: { cursor?: string }) => {
                lists.push(input)

                return input.cursor
                  ? { data: sessions.slice(3), cursor: {} }
                  : { data: sessions.slice(0, 3), cursor: { next: "second" } }
              },
              view: async (input: { sessionID: string; idle: number }) => {
                views.push(input)

                if (failures.remaining-- > 0) throw new Error("offline")
              },
            },
          },
        },
        data: { session: { get: () => undefined, root: (id: string) => id } },
        coordinator: {},
      }),
    }))

  // Sessions come from fetched snapshots here, like home rows for sessions that aren't loaded.
  const unread = (state: ReturnType<typeof start>["state"]) =>
    sessions.flatMap((session) =>
      // SAFETY: the snapshots carry the id and time fields unread state reads.
      state.session.unread(session.id, session as never) ? [session.id] : [],
    )

  // Advances fake time, then lets the mocked requests it started settle.
  const advance = async (ms: number) => {
    vi.advanceTimersByTime(ms)

    for (const _ of Array.from({ length: 50 })) await Promise.resolve()
  }

  const first = start()
  // Until the stored list is read, nothing it had read can flash unread.
  expect(unread(first.state)).toEqual([])
  await advance(0)

  // Nothing read here lights up, while a session that went idle after the list was found is new.
  expect(unread(first.state)).toEqual(["unread-here", "new"])

  // The carry-over waits for startup to settle, then a failed report keeps the list for the next connection.
  await advance(4_999)
  expect(lists).toEqual([])
  await advance(1)
  expect(views).toEqual([{ sessionID: "read-here", idle: 5 }])
  expect(JSON.parse(localStorage.getItem(key) ?? "null")).toMatchObject({ started: 10 })
  first.dispose()

  // A later start keeps the first start's cutoff, reports every page, then deletes the list without anything flashing.
  setSystemTime(new Date(100))
  lists.length = 0
  views.length = 0
  const second = start()
  await advance(0)
  expect(unread(second.state)).toEqual(["unread-here", "new"])
  await advance(5_000)
  expect(lists).toEqual([
    { limit: 200, order: "desc", parentID: null },
    { limit: 200, order: "desc", parentID: null, cursor: "second" },
  ])
  expect(views).toEqual([
    { sessionID: "read-here", idle: 5 },
    { sessionID: "untracked", idle: 7 },
  ])
  expect(localStorage.getItem(key)).toBeNull()
  expect(unread(second.state)).toEqual(["unread-here", "new"])
  second.dispose()

  // Without the old list, later starts never touch the server's viewed state.
  const third = start()
  await advance(5_000)
  expect(lists).toHaveLength(2)
  expect(views).toHaveLength(2)
  third.dispose()
  vi.useRealTimers()
  setSystemTime()
})

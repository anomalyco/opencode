import { SessionID } from "@opencode/schema/session-id"
import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { ServerSDK } from "@/runtime/server/client"
import type { Data } from "@opencode/client/solid"
import type { ServerConnection } from "@/runtime/server/registry"
import { ServerScope } from "@/runtime/server/scope"
import type { Tab } from "@/shell/tabs/tabs"

const server = "local\nhttp://localhost:4096" as ServerConnection.Key

const session = { id: "session-1", title: "Test session", location: { directory: "/project" } }

const alerts: string[] = []

const tabs: { store: Tab[] } = { store: [] }

let createServerNotificationState: typeof import("./notification").createServerNotificationState

let storage: typeof import("@/runtime/persistence/storage")

beforeAll(async () => {
  storage = await import("@/runtime/persistence/storage")
  const { sessionIDHasOpenTab } = await import("@/shell/tabs/tabs")
  mock.module("@/runtime/platform/platform", () => ({
    usePlatform: () => ({
      platform: "web",
      notify: async (title: string) => {
        alerts.push(title)
      },
    }),
  }))
  mock.module("@/settings/model", () => ({
    useSettings: () => ({
      sounds: { agentEnabled: () => false, errorsEnabled: () => false },
      notifications: { agent: () => true, errors: () => true },
    }),
  }))
  mock.module("@/runtime/i18n/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
  mock.module("@/shell/tabs/tabs", () => ({
    useTabs: () => tabs,
    sessionIDHasOpenTab,
  }))
  mock.module("@/runtime/persistence/storage", () => ({
    ...storage,
    persisted: () => {
      const [store, setStore] = createStore({ list: [] })

      return [store, setStore, undefined, () => false]
    },
  }))
  createServerNotificationState = (await import("./notification")).createServerNotificationState
})

afterAll(() => mock.module("@/runtime/persistence/storage", () => storage))

test.each([
  ["session.execution.succeeded", "notification.session.responseReady.title"],
  ["session.execution.failed", "notification.session.error.title"],
] as const)("system alert for %s requires an open session tab", async (type, title) => {
  alerts.length = 0
  tabs.store = [{ type: "session", server, sessionId: SessionID.make("another-session", { disableChecks: true }) }]
  let listener: ((event: unknown) => void) | undefined

  const dispose = createRoot((dispose) => {
    const state = createServerNotificationState({
      key: server,
      sdk: {
        scope: ServerScope.local,
        event: {
          listen: (fn: typeof listener) => {
            listener = fn

            return () => {}
          },
        },
      } as unknown as ServerSDK,
      data: { session: { get: () => session } } as unknown as Data,
      coordinator: { system: async (_id: string, fn: () => Promise<void>) => fn() },
    } as Parameters<typeof createServerNotificationState>[0])

    return { dispose, state }
  })

  listener?.({
    type,
    id: "event-1",
    data: { sessionID: session.id, error: { type: "api", message: "failed", status: 500 } },
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(dispose.state.session.all(session.id)).toHaveLength(1)
  expect(alerts).toEqual([])

  tabs.store = [{ type: "session", server, sessionId: SessionID.make(session.id, { disableChecks: true }) }]
  listener?.({
    type,
    id: "event-2",
    data: { sessionID: session.id, error: { type: "api", message: "failed", status: 500 } },
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(alerts).toEqual([title])
  dispose.dispose()
})

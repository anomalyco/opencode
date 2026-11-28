/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { OpenCodeEvent, PermissionRequest } from "@opencode/client"
import { testRender } from "@opentui/solid"
import { ConfigProvider, useConfig, type Config } from "../../src/config"
import { ArgsProvider } from "../../src/context/args"
import { ClientProvider, useClient } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { Keymap } from "../../src/context/keymap"
import { LocalProvider } from "../../src/context/local"
import { LocationProvider } from "../../src/context/location"
import { PermissionProvider } from "../../src/context/permission"
import { RouteProvider } from "../../src/context/route"
import { TuiAppProvider } from "../../src/context/runtime"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { tmpdir } from "../fixture/fixture"
import { session } from "../fixture/local"
import { createApi, createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

interface ReplyRecord {
  readonly sessionID: string
  readonly requestID: string
  readonly body: unknown
}

async function renderAutoAccept(options?: {
  auto?: boolean
  permissionsMode?: "prompt" | "autoaccept"
  activeSessions?: Record<string, { type: "running" }>
  pendingBySession?: Record<string, PermissionRequest[]>
}) {
  const temporary = await tmpdir()
  const events = createEventStream()
  const replies: ReplyRecord[] = []
  const replyWaiters: Array<() => void> = []
  const mounted = Promise.withResolvers<void>()
  const connected = Promise.withResolvers<void>()
  const pendingBySession = new Map<string, PermissionRequest[]>(
    Object.entries(options?.pendingBySession ?? {}).map(([sessionID, items]) => [sessionID, [...items]]),
  )
  const activeSessions = options?.activeSessions ?? {}

  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/session/active") {
      return json({ data: activeSessions })
    }
    const sessionMatch = /^\/api\/session\/([^/]+)$/.exec(url.pathname)
    if (sessionMatch && sessionMatch[1] && request.method === "GET") {
      return json({ data: session(sessionMatch[1]) })
    }
    const listMatch = /^\/api\/session\/([^/]+)\/permission$/.exec(url.pathname)
    if (listMatch && listMatch[1] && request.method === "GET") {
      return json({ data: pendingBySession.get(listMatch[1]) ?? [] })
    }
    const replyMatch = /^\/api\/session\/([^/]+)\/permission\/([^/]+)\/reply$/.exec(url.pathname)
    if (replyMatch && replyMatch[1] && replyMatch[2] && request.method === "POST") {
      const sessionID = replyMatch[1]
      const requestID = replyMatch[2]
      const body: unknown = await request.json()
      pendingBySession.set(
        sessionID,
        (pendingBySession.get(sessionID) ?? []).filter((item) => item.id !== requestID),
      )
      replies.push({ sessionID, requestID, body })
      for (const notify of replyWaiters.splice(0)) notify()
      return new Response(null, { status: 204 })
    }
  }, events)

  let client: ReturnType<typeof useClient> | undefined
  let config: ReturnType<typeof useConfig> | undefined
  let configuration: Config.Info = {
    session: {
      permissions: options?.permissionsMode ?? "prompt",
    },
  }

  function Probe() {
    client = useClient()
    config = useConfig()
    mounted.resolve()
    return <box />
  }

  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path, home: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <ArgsProvider auto={options?.auto}>
            <ConfigProvider
              config={createTuiResolvedConfig(configuration)}
              service={{
                get: async () => configuration,
                update: async (update) => {
                  configuration = structuredClone(configuration)
                  update(configuration)
                  return configuration
                },
              }}
            >
              <Keymap.Provider>
                <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
                  <ToastProvider>
                    <RouteProvider initialRoute={{ type: "home" }}>
                      <ClientProvider api={createApi(calls.fetch)}>
                        <PermissionProvider>
                          <DataProvider directory={directory}>
                            <LocationProvider>
                              <LocalProvider>
                                <DialogProvider>
                                  <Probe />
                                </DialogProvider>
                              </LocalProvider>
                            </LocationProvider>
                          </DataProvider>
                        </PermissionProvider>
                      </ClientProvider>
                    </RouteProvider>
                  </ToastProvider>
                </ThemeProvider>
              </Keymap.Provider>
            </ConfigProvider>
          </ArgsProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )

  await mounted.promise
  if (!client || !config) throw new Error("Probe did not initialize contexts")
  const activeClient = client
  const activeConfig = config
  const unsubscribe = activeClient.event.on("server.connected", () => connected.resolve())
  if (activeClient.connection.status() === "connected") connected.resolve()
  await connected.promise
  unsubscribe()

  return {
    replies,
    emit(event: OpenCodeEvent) {
      events.emit(event)
    },
    async waitForReplies(count: number) {
      while (replies.length < count) {
        const next = Promise.withResolvers<void>()
        replyWaiters.push(next.resolve)
        await next.promise
      }
    },
    setMode(mode: "prompt" | "autoaccept") {
      return activeConfig.update((draft) => {
        draft.session ??= {}
        draft.session.permissions = mode
      })
    },
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
      await temporary[Symbol.asyncDispose]()
    },
  }
}

test("autoaccept replies to live permission requests on background sessions when no session route is mounted", async () => {
  await using harness = await renderAutoAccept({ permissionsMode: "autoaccept" })

  harness.emit({
    id: "evt_perm_bg",
    created: 1,
    type: "permission.asked",
    data: {
      id: "per_bg_1",
      sessionID: "ses_background",
      action: "edit",
      resources: ["weather.ino"],
      save: ["*"],
    },
  })

  await harness.waitForReplies(1)
  expect(harness.replies).toEqual([
    {
      sessionID: "ses_background",
      requestID: "per_bg_1",
      body: { decision: "once" },
    },
  ])
})

test("autoaccept sweeps active server sessions on connect to clear resumed background prompts", async () => {
  await using harness = await renderAutoAccept({
    auto: true,
    activeSessions: { ses_resumed: { type: "running" } },
    pendingBySession: {
      ses_resumed: [
        {
          id: "per_resumed_edit",
          sessionID: "ses_resumed",
          action: "edit",
          resources: ["weather.ino"],
          save: ["*"],
        },
      ],
    },
  })

  await harness.waitForReplies(1)
  expect(harness.replies).toEqual([
    {
      sessionID: "ses_resumed",
      requestID: "per_resumed_edit",
      body: { decision: "once" },
    },
  ])
})

test("switching permissions mode from prompt to autoaccept sweeps and approves pending background requests", async () => {
  await using harness = await renderAutoAccept({
    permissionsMode: "prompt",
    activeSessions: { ses_other: { type: "running" } },
    pendingBySession: {
      ses_other: [
        {
          id: "per_waiting",
          sessionID: "ses_other",
          action: "edit",
          resources: ["shared.txt"],
          save: ["*"],
        },
      ],
    },
  })

  expect(harness.replies).toEqual([])
  await harness.setMode("autoaccept")
  await harness.waitForReplies(1)
  expect(harness.replies).toEqual([
    {
      sessionID: "ses_other",
      requestID: "per_waiting",
      body: { decision: "once" },
    },
  ])
})

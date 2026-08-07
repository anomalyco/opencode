import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
  SnapshotFileDiff,
  ConsoleState,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "./project"
import { useEvent } from "./event"
import { useSDK } from "./sdk"
import { useTuiStartup } from "./runtime"
import { createSimpleContext } from "./helper"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onCleanup, onMount } from "solid-js"
import path from "path"
import { useKV } from "./kv"
import { usePermission } from "./permission"
import { createReconnectCoordinator } from "./sync-reconnect"

const emptyConsoleState: ConsoleState = {
  consoleManagedProviders: [],
  switchableOrgCount: 0,
}

function responseData<T>(response: { readonly data?: T }) {
  if (response.data !== undefined) return response.data
  throw new TypeError("Expected response data")
}

function search<T>(items: T[], target: string, key: (item: T) => string) {
  let left = 0
  let right = items.length - 1
  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    const value = key(items[middle])
    if (value === target) return { found: true, index: middle }
    if (value < target) left = middle + 1
    else right = middle - 1
  }
  return { found: false, index: left }
}

export const {
  context: SyncContext,
  use: useSync,
  provider: SyncProvider,
} = createSimpleContext({
  name: "Sync",
  init: () => {
    const startup = useTuiStartup()
    const kv = useKV()
    const permission = usePermission()
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      console_state: ConsoleState
      capabilities: {
        experimentalBackgroundSubagents: boolean
      }
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: SnapshotFileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      console_state: emptyConsoleState,
      capabilities: {
        experimentalBackgroundSubagents: false,
      },
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()

    const fullSyncedSessions = new Set<string>()
    const strictRecoverySessions = new Set<string>()
    const syncingSessions = new Map<string, Promise<void>>()
    const hydratingSessions = new Map<string, { messages: Set<string>; parts: Set<string>; invalidated: boolean }>()
    let disposed = false
    const touchMessage = (sessionID: string, messageID: string) => {
      hydratingSessions.get(sessionID)?.messages.add(messageID)
    }
    const touchPart = (sessionID: string, partID: string) => {
      hydratingSessions.get(sessionID)?.parts.add(partID)
    }

    function sessionListQuery(): { scope?: "project"; path?: string } {
      if (!kv.get("session_directory_filter_enabled", true)) return { scope: "project" }
      if (!project.data.instance.path.worktree || !project.data.instance.path.directory) return { scope: "project" }
      return {
        path: path
          .relative(path.resolve(project.data.instance.path.worktree), project.data.instance.path.directory)
          .replaceAll("\\", "/"),
      }
    }

    function listSessions(recovery = false) {
      const query = { start: Date.now() - 30 * 24 * 60 * 60 * 1000, ...sessionListQuery() }
      const request = recovery
        ? sdk.client.session.list(query, { throwOnError: true }).then(responseData)
        : sdk.client.session.list(query).then((response) => response.data ?? [])
      return request.then((sessions) => sessions.toSorted((a, b) => a.id.localeCompare(b.id)))
    }

    function pruneSession(sessionID: string) {
      const tracker = hydratingSessions.get(sessionID)
      if (tracker) tracker.invalidated = true
      fullSyncedSessions.delete(sessionID)
      strictRecoverySessions.delete(sessionID)
      setStore(
        produce((draft) => {
          const match = search(draft.session, sessionID, (item) => item.id)
          if (match.found) draft.session.splice(match.index, 1)
          delete draft.permission[sessionID]
          delete draft.question[sessionID]
          delete draft.session_status[sessionID]
          delete draft.todo[sessionID]
          delete draft.session_diff[sessionID]
          for (const message of draft.message[sessionID] ?? []) delete draft.part[message.id]
          delete draft.message[sessionID]
          for (const [messageID, parts] of Object.entries(draft.part)) {
            if (parts.some((part) => part.sessionID === sessionID)) delete draft.part[messageID]
          }
        }),
      )
    }

    function replaceSessions(sessions: Session[], recovery = false) {
      if (recovery) {
        const present = new Set(sessions.map((session) => session.id))
        for (const sessionID of store.session.map((session) => session.id)) {
          if (!present.has(sessionID)) pruneSession(sessionID)
        }
      }
      setStore("session", reconcile(sessions))
    }

    const reconnect = createReconnectCoordinator({
      bootstrap: () => bootstrap({ fatal: false, wait: true, report: false, recovery: true }),
      targets: () => [...fullSyncedSessions, ...syncingSessions.keys()],
      exists: (sessionID) => store.session.some((session) => session.id === sessionID),
      forceSync: (sessionID) => syncSession(sessionID, { force: true }),
      onError: (failure) => {
        const error = failure.error
        console.error("tui reconnect reconciliation failed", {
          boundary: failure.boundary,
          ...(failure.boundary === "session" ? { sessionID: failure.sessionID } : {}),
          error: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : undefined,
        })
      },
    })
    const unsubscribe = event.subscribe((event, { directory, workspace }) => {
      switch (event.type) {
        case "server.connected":
          void reconnect.connected()
          break
        case "server.instance.disposed":
          void bootstrap()
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          if (permission.mode === "auto") {
            void sdk.client.permission.reply({
              requestID: request.id,
              reply: "once",
              directory,
              workspace,
            })
            break
          }
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          pruneSession(event.properties.info.id)
          break
        }
        case "session.updated": {
          const result = search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.next.moved": {
          const result = search(store.session, event.properties.sessionID, (s) => s.id)
          if (!result.found) break
          setStore(
            "session",
            result.index,
            produce((session) => {
              session.directory = event.properties.location.directory
              session.path = event.properties.subdirectory
              session.workspaceID = event.properties.location.workspaceID
              session.time.updated = event.properties.timestamp
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "message.updated": {
          touchMessage(event.properties.info.sessionID, event.properties.info.id)
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          const updated = store.message[event.properties.info.sessionID]
          if (updated.length > 100) {
            const oldest = updated[0]
            batch(() => {
              setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft) => {
                  draft.shift()
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  delete draft[oldest.id]
                }),
              )
            })
          }
          break
        }
        case "message.removed": {
          touchMessage(event.properties.sessionID, event.properties.messageID)
          const messages = store.message[event.properties.sessionID]
          const result = search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          touchPart(event.properties.part.sessionID, event.properties.part.id)
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            break
          }
          const result = search(parts, event.properties.part.id, (p) => p.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          break
        }

        case "message.part.delta": {
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = search(parts, event.properties.partID, (p) => p.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, event.properties.partID)
          setStore(
            "part",
            event.properties.messageID,
            produce((draft) => {
              const part = draft[result.index]
              const field = event.properties.field as keyof typeof part
              const existing = part[field] as string | undefined
              ;(part[field] as string) = (existing ?? "") + event.properties.delta
            }),
          )
          break
        }

        case "message.part.removed": {
          touchPart(event.properties.sessionID, event.properties.partID)
          const parts = store.part[event.properties.messageID]
          const result = search(parts, event.properties.partID, (p) => p.id)
          if (result.found) {
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }

        case "lsp.updated": {
          const workspace = project.workspace.current()
          void sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", x.data ?? []))
          break
        }

        case "vcs.branch.updated": {
          if (workspace === project.workspace.current()) {
            setStore("vcs", { branch: event.properties.branch })
          }
          break
        }
      }
    })
    onCleanup(() => {
      disposed = true
      reconnect.dispose()
      unsubscribe()
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap(input: { fatal?: boolean; wait?: boolean; report?: boolean; recovery?: boolean } = {}) {
      const fatal = input.fatal ?? true
      const wait = input.wait ?? false
      const report = input.report ?? true
      const recovery = input.recovery ?? false
      const workspace = project.workspace.current()
      const fail = async (error: unknown, detached: boolean) => {
        if (report || (detached && !fatal)) {
          console.error("tui bootstrap failed", {
            error: error instanceof Error ? error.message : String(error),
            name: error instanceof Error ? error.name : undefined,
            stack: error instanceof Error ? error.stack : undefined,
          })
        }
        if (fatal) return exit(error)
        if (!detached) throw error
      }
      const projectPromise = project.sync()
      const sessionListPromise = projectPromise.then(() => listSessions(recovery))

      // blocking - include session.list when continuing a session
      const providersPromise = sdk.client.config.providers({ workspace }, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({ workspace }, { throwOnError: true })
      const capabilitiesPromise = sdk.client.experimental.capabilities
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => undefined)
      const consoleStatePromise = sdk.client.experimental.console
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => emptyConsoleState)
      const agentsPromise = sdk.client.app.agents({ workspace }, { throwOnError: true })
      const configPromise = sdk.client.config.get({ workspace }, { throwOnError: true })
      await Promise.all([
        providersPromise,
        providerListPromise,
        capabilitiesPromise,
        agentsPromise,
        configPromise,
        projectPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ])
        .then(async () => {
          const providersResponse = providersPromise.then(responseData)
          const providerListResponse = providerListPromise.then(responseData)
          const capabilitiesResponse = capabilitiesPromise
          const consoleStateResponse = consoleStatePromise
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then(responseData)
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          return Promise.all([
            providersResponse,
            providerListResponse,
            capabilitiesResponse,
            consoleStateResponse,
            agentsResponse,
            configResponse,
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const providers = responses[0]
            const providerList = responses[1]
            const capabilities = responses[2]
            const consoleState = responses[3]
            const agents = responses[4]
            const config = responses[5]
            const sessions = responses[6]

            batch(() => {
              setStore("provider", reconcile(providers.providers))
              setStore("provider_default", reconcile(providers.default))
              setStore("provider_next", reconcile(providerList))
              setStore("capabilities", "experimentalBackgroundSubagents", capabilities?.backgroundSubagents === true)
              setStore("console_state", reconcile(consoleState))
              setStore("agent", reconcile(agents))
              setStore("config", reconcile(config))
              if (sessions !== undefined && !recovery) replaceSessions(sessions)
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          const complete = Promise.all([
            ...(args.continue || recovery ? [] : [sessionListPromise.then((sessions) => replaceSessions(sessions))]),
            consoleStatePromise.then((consoleState) => setStore("console_state", reconcile(consoleState))),
            sdk.client.command.list({ workspace }).then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", reconcile(x.data ?? []))),
            sdk.client.mcp.status({ workspace }).then((x) => setStore("mcp", reconcile(x.data ?? {}))),
            sdk.client.experimental.resource
              .list({ workspace })
              .then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status({ workspace }).then((x) => setStore("formatter", reconcile(x.data ?? []))),
            recovery
              ? Promise.all([
                  sessionListPromise,
                  sdk.client.session.status({ workspace }, { throwOnError: true }).then(responseData),
                ]).then(([sessions, statuses]) => {
                  const present = new Set(sessions.map((session) => session.id))
                  batch(() => {
                    replaceSessions(sessions, true)
                    setStore(
                      "session_status",
                      reconcile(
                        Object.fromEntries(Object.entries(statuses).filter(([sessionID]) => present.has(sessionID))),
                      ),
                    )
                  })
                })
              : sdk.client.session
                  .status({ workspace })
                  .then((response) => setStore("session_status", reconcile(response.data ?? {}))),
            sdk.client.provider.auth({ workspace }).then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get({ workspace }).then((x) => setStore("vcs", reconcile(x.data))),
            project.workspace.sync(),
          ]).then(() => {
            setStore("status", "complete")
          })
          if (wait) return complete
          void complete.catch((error) => fail(error, true))
        })
        .catch((error) => fail(error, false))
    }

    async function syncSession(sessionID: string, input: { force: boolean }) {
      if (disposed) return
      if (!input.force && fullSyncedSessions.has(sessionID)) return
      const older = syncingSessions.get(sessionID)
      if (older) {
        if (!input.force) return older
        await Promise.allSettled([older])
        if (disposed) return
      }
      if (input.force) fullSyncedSessions.delete(sessionID)
      const strict = input.force || strictRecoverySessions.has(sessionID)
      const tracker = { messages: new Set<string>(), parts: new Set<string>(), invalidated: false }
      hydratingSessions.set(sessionID, tracker)
      const task = (async () => {
        const [session, messages, todo, diff] = await Promise.all([
          sdk.client.session.get({ sessionID }, { throwOnError: true }),
          sdk.client.session.messages({ sessionID, limit: 100 }, { throwOnError: strict }),
          sdk.client.session.todo({ sessionID }, { throwOnError: strict }),
          sdk.client.session.diff({ sessionID }, { throwOnError: strict }),
        ])
        if (disposed || tracker.invalidated) return
        const info = session.data
        if (!info) return
        setStore(
          produce((draft) => {
            const match = search(draft.session, sessionID, (s) => s.id)
            if (match.found) draft.session[match.index] = info
            if (!match.found) draft.session.splice(match.index, 0, info)
            draft.todo[sessionID] = todo.data ?? []
            const currentMessages = draft.message[sessionID] ?? []
            const infos = (messages.data ?? []).flatMap((message) => {
              if (!tracker.messages.has(message.info.id)) return [message.info]
              const current = currentMessages.find((item) => item.id === message.info.id)
              return current ? [current] : []
            })
            infos.push(
              ...currentMessages.filter(
                (message) => tracker.messages.has(message.id) && !infos.some((item) => item.id === message.id),
              ),
            )
            const removed = infos.slice(0, -100)
            const visible = infos.slice(-100)
            const visibleIDs = new Set(visible.map((message) => message.id))
            for (const message of currentMessages) {
              if (!visibleIDs.has(message.id)) delete draft.part[message.id]
            }
            for (const message of messages.data ?? []) {
              if (!visibleIDs.has(message.info.id)) {
                delete draft.part[message.info.id]
                continue
              }
              const currentParts = draft.part[message.info.id] ?? []
              const parts = message.parts.flatMap((part) => {
                const current = currentParts.find((item) => item.id === part.id)
                if (tracker.parts.has(part.id)) return current ? [current] : []
                if (
                  current &&
                  (part.type === "text" || part.type === "reasoning") &&
                  (current.type === "text" || current.type === "reasoning") &&
                  part.text.length === 0 &&
                  current.text.length > 0
                ) {
                  return [current]
                }
                return [part]
              })
              parts.push(
                ...currentParts.filter(
                  (part) => tracker.parts.has(part.id) && !parts.some((item) => item.id === part.id),
                ),
              )
              draft.part[message.info.id] = parts
            }
            for (const message of removed) delete draft.part[message.id]
            draft.message[sessionID] = visible
            draft.session_diff[sessionID] = diff.data ?? []
          }),
        )
        fullSyncedSessions.add(sessionID)
        strictRecoverySessions.delete(sessionID)
      })()
        .catch((error) => {
          if (strict && !disposed && !tracker.invalidated) strictRecoverySessions.add(sessionID)
          throw error
        })
        .finally(() => {
          syncingSessions.delete(sessionID)
          hydratingSessions.delete(sessionID)
        })
      syncingSessions.set(sessionID, task)
      return task
    }

    onMount(() => {
      void bootstrap()
    })

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        if (startup.skipInitialLoading) return true
        return store.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(sessionID: string) {
          const match = search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        query() {
          return sessionListQuery()
        },
        async refresh() {
          const list = await listSessions()
          setStore("session", reconcile(list))
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string) {
          return syncSession(sessionID, { force: false })
        },
      },
      bootstrap,
    }
    return result
  },
})

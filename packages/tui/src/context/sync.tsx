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
import { batch, onMount } from "solid-js"
import path from "path"
import { useKV } from "./kv"
import { usePermission } from "./permission"

const emptyConsoleState: ConsoleState = {
  consoleManagedProviders: [],
  switchableOrgCount: 0,
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

function compareMessage(a: Message, b: Message) {
  return a.time.created - b.time.created || a.id.localeCompare(b.id)
}

const messageKey = (message: Message) => message.time.created + message.id

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
      messageOlderCursor: {
        [sessionID: string]: string | null
      }
      messageNewerCursor: {
        [sessionID: string]: string | null
      }
      messageOlderLoading: {
        [sessionID: string]: boolean
      }
      messageNewerLoading: {
        [sessionID: string]: boolean
      }
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
      messageOlderCursor: {},
      messageNewerCursor: {},
      messageOlderLoading: {},
      messageNewerLoading: {},
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()

    const fullSyncedSessions = new Set<string>()
    const syncingSessions = new Map<string, Promise<void>>()
    const hydratingSessions = new Map<string, { messages: Set<string>; parts: Set<string> }>()
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

    function listSessions() {
      return sdk.client.session
        .list({ start: Date.now() - 30 * 24 * 60 * 60 * 1000, ...sessionListQuery() })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))
    }

    event.subscribe((event, { directory, workspace }) => {
      switch (event.type) {
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
          const result = search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
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
          const sessionID = event.properties.info.sessionID
          const messages = store.message[sessionID]
          if (!messages) {
            setStore("message", sessionID, [event.properties.info])
            break
          }
          const result = search(messages, messageKey(event.properties.info), messageKey)
          if (result.found) {
            setStore("message", sessionID, result.index, reconcile(event.properties.info))
            break
          }
          // If the bottom of the window has been evicted (messageNewerCursor
          // is set), drop messages that arrive past our visible tail. They
          // will be loaded on demand when the user scrolls back down.
          if (store.messageNewerCursor[sessionID]) {
            const last = messages[messages.length - 1]
            if (last) {
              const incoming = event.properties.info
              const isPastTail =
                incoming.time.created > last.time.created ||
                (incoming.time.created === last.time.created && incoming.id > last.id)
              if (isPastTail) break
            }
          }
          setStore(
            "message",
            sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }
        case "message.removed": {
          touchMessage(event.properties.sessionID, event.properties.messageID)
          const messages = store.message[event.properties.sessionID]
          const index = messages.findIndex((message) => message.id === event.properties.messageID)
          if (index !== -1) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          const sessionID = event.properties.part.sessionID
          const messageID = event.properties.part.messageID
          const parts = store.part[messageID]
          // If the parent message isn't in our window AND the window's
          // bottom has been evicted, drop the part - it would otherwise
          // be orphaned in store.part with no message to attach to.
          const messages = store.message[sessionID]
          const inWindow = !messages || search(messages, messageID, (m) => m.id).found
          if (!parts) {
            if (!inWindow && store.messageNewerCursor[sessionID]) break
            setStore("part", messageID, [event.properties.part])
            break
          }
          const result = search(parts, event.properties.part.id, (part) => part.id)
          if (result.found) {
            setStore("part", messageID, result.index, reconcile(event.properties.part))
            break
          }
          setStore(
            "part",
            messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          break
        }

        case "message.part.delta": {
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = search(parts, event.properties.partID, (part) => part.id)
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
          const result = search(parts, event.properties.partID, (part) => part.id)
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

    const exit = useExit()
    const args = useArgs()

    async function bootstrap(input: { fatal?: boolean } = {}) {
      const fatal = input.fatal ?? true
      const workspace = project.workspace.current()
      const projectPromise = project.sync()
      const sessionListPromise = projectPromise.then(() => listSessions())

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
          const providersResponse = providersPromise.then((x) => x.data!)
          const providerListResponse = providerListPromise.then((x) => x.data!)
          const capabilitiesResponse = capabilitiesPromise
          const consoleStateResponse = consoleStatePromise
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data!)
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
              if (sessions !== undefined) setStore("session", reconcile(sessions))
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          void Promise.all([
            ...(args.continue ? [] : [sessionListPromise.then((sessions) => setStore("session", reconcile(sessions)))]),
            consoleStatePromise.then((consoleState) => setStore("console_state", reconcile(consoleState))),
            sdk.client.command.list({ workspace }).then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", reconcile(x.data ?? []))),
            sdk.client.mcp.status({ workspace }).then((x) => setStore("mcp", reconcile(x.data ?? {}))),
            sdk.client.experimental.resource
              .list({ workspace })
              .then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status({ workspace }).then((x) => setStore("formatter", reconcile(x.data ?? []))),
            sdk.client.session.status({ workspace }).then((x) => {
              setStore("session_status", reconcile(x.data ?? {}))
            }),
            sdk.client.provider.auth({ workspace }).then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get({ workspace }).then((x) => setStore("vcs", reconcile(x.data))),
            project.workspace.sync(),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          console.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          if (fatal) {
            exit(e)
          } else {
            throw e
          }
        })
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
          if (fullSyncedSessions.has(sessionID)) return
          const hydration = { messages: new Set<string>(), parts: new Set<string>() }
          hydratingSessions.set(sessionID, hydration)
          try {
            const [session, messages, todo, diff] = await Promise.all([
              sdk.client.session.get({ sessionID }, { throwOnError: true }),
              sdk.client.session.messages({ sessionID, limit: INITIAL_PAGE_SIZE }),
              sdk.client.session.todo({ sessionID }),
              sdk.client.session.diff({ sessionID }),
            ])
            const olderCursor = (messages.response?.headers.get("x-next-cursor") as string | null | undefined) ?? null
            setStore(
              produce((draft) => {
                const match = search(draft.session, sessionID, (s) => s.id)
                if (match.found) draft.session[match.index] = session.data!
                if (!match.found) draft.session.splice(match.index, 0, session.data!)
                draft.todo[sessionID] = todo.data ?? []
                if (messages.data) {
                  const existing = draft.message[sessionID] ?? []
                  const infos: (typeof draft.message)[string] = []
                  const hydratedIDs = new Set<string>()
                  for (const message of messages.data) {
                    hydratedIDs.add(message.info.id)
                    const current = existing.find((item) => item.id === message.info.id)
                    if (current) {
                      infos.push(current)
                      continue
                    }
                    if (hydration.messages.has(message.info.id)) continue
                    infos.push(message.info)
                    draft.part[message.info.id] = message.parts
                  }
                  for (const message of existing) {
                    if (hydratedIDs.has(message.id)) continue
                    infos.push(message)
                  }
                  while (infos.length > INITIAL_PAGE_SIZE) {
                    const evicted = infos.shift()
                    if (evicted) delete draft.part[evicted.id]
                  }
                  draft.message[sessionID] = infos.sort(compareMessage)
                  draft.messageOlderCursor[sessionID] = olderCursor
                  draft.messageNewerCursor[sessionID] = null
                }
                draft.session_diff[sessionID] = diff.data ?? []
              }),
            )
            if (!olderCursor) fullSyncedSessions.add(sessionID)
          } finally {
            hydratingSessions.delete(sessionID)
          }
        },
        async loadOlderMessages(sessionID: string) {
          const cursor = store.messageOlderCursor[sessionID]
          if (!cursor || store.messageOlderLoading[sessionID]) return
          setStore("messageOlderLoading", sessionID, true)
          try {
            const res = await sdk.client.session.messages({ sessionID, limit: PAGE_SIZE, before: cursor })
            const nextCursor = (res.response?.headers.get("x-next-cursor") as string | null | undefined) ?? null
            setStore(
              produce((draft) => {
                const existing = draft.message[sessionID] ?? []
                const prepend: Message[] = []
                for (const m of res.data ?? []) {
                  draft.part[m.info.id] = m.parts
                  prepend.push(m.info)
                }
                draft.message[sessionID] = [...prepend, ...existing].sort(compareMessage)
                draft.messageOlderCursor[sessionID] = nextCursor
              }),
            )
            if (!nextCursor && !store.messageNewerCursor[sessionID]) fullSyncedSessions.add(sessionID)
          } finally {
            setStore("messageOlderLoading", sessionID, false)
          }
        },
        async loadNewerMessages(sessionID: string) {
          const cursor = store.messageNewerCursor[sessionID]
          if (!cursor || store.messageNewerLoading[sessionID]) return
          setStore("messageNewerLoading", sessionID, true)
          try {
            const res = await sdk.client.session.messages({ sessionID, limit: PAGE_SIZE, after: cursor })
            const nextCursor = (res.response?.headers.get("x-next-cursor") as string | null | undefined) ?? null
            setStore(
              produce((draft) => {
                const existing = draft.message[sessionID] ?? []
                const append: Message[] = []
                for (const m of res.data ?? []) {
                  draft.part[m.info.id] = m.parts
                  append.push(m.info)
                }
                draft.message[sessionID] = [...existing, ...append].sort(compareMessage)
                draft.messageNewerCursor[sessionID] = nextCursor
              }),
            )
            if (!nextCursor && !store.messageOlderCursor[sessionID]) fullSyncedSessions.add(sessionID)
          } finally {
            setStore("messageNewerLoading", sessionID, false)
          }
        },
        trimNewerMessages(sessionID: string, cap: number) {
          const messages = store.message[sessionID]
          if (!messages || messages.length <= cap) return
          // Find the largest "safe" prefix length we can keep without
          // discarding a message that's still in flight (assistants
          // currently streaming) - those need to remain pinned so live
          // events can update them.
          let target = cap
          while (target < messages.length) {
            const tail = messages.slice(target)
            const hasInflight = tail.some(
              (m) => m.role === "assistant" && !m.time?.completed,
            )
            if (!hasInflight) break
            target++
          }
          if (target >= messages.length) return
          const evicted = messages.slice(target)
          const newLast = messages[target - 1]
          if (!newLast) return
          const cursorVal = encodeMessageCursor({ id: newLast.id, time: newLast.time.created })
          setStore(
            produce((draft) => {
              const arr = draft.message[sessionID]
              for (const ev of evicted) delete draft.part[ev.id]
              arr.length = target
              draft.messageNewerCursor[sessionID] = cursorVal
            }),
          )
          fullSyncedSessions.delete(sessionID)
        },
        trimOlderMessages(sessionID: string, cap: number) {
          const messages = store.message[sessionID]
          if (!messages || messages.length <= cap) return
          const drop = messages.length - cap
          const evicted = messages.slice(0, drop)
          const newFirst = messages[drop]
          if (!newFirst) return
          const cursorVal = encodeMessageCursor({ id: newFirst.id, time: newFirst.time.created })
          setStore(
            produce((draft) => {
              const arr = draft.message[sessionID]
              for (const ev of evicted) delete draft.part[ev.id]
              arr.splice(0, drop)
              draft.messageOlderCursor[sessionID] = cursorVal
            }),
          )
          fullSyncedSessions.delete(sessionID)
        },
        async loadAllMessages(sessionID: string) {
          // Page through both directions until exhausted. Used by the
          // Timeline dialog so it can render every prompt in the session.
          while (store.messageOlderCursor[sessionID]) {
            await result.session.loadOlderMessages(sessionID)
          }
          while (store.messageNewerCursor[sessionID]) {
            await result.session.loadNewerMessages(sessionID)
          }
        },
      },
      bootstrap,
    }
    return result
  },
})

const INITIAL_PAGE_SIZE = 100
const PAGE_SIZE = 50

function encodeMessageCursor(input: { id: string; time: number }): string {
  return Buffer.from(JSON.stringify(input)).toString("base64url")
}

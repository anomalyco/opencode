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
  PermissionClassificationDetails,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "./project"
import { useEvent } from "./event"
import { useSDK } from "./sdk"
import { useTuiStartup } from "./runtime"
import { createSimpleContext } from "./helper"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, createEffect, createMemo, onMount } from "solid-js"
import path from "path"
import { useKV } from "./kv"
import { usePermission } from "./permission"

const emptyConsoleState: ConsoleState = {
  consoleManagedProviders: [],
  switchableOrgCount: 0,
}

type AutoApprovalAttempt = {
  request: PermissionRequest
  directory: string
  revision: number
  resolved: boolean
  recovered: boolean
  // Set the moment the `once` reply is dispatched, cleared when it settles.
  replying: boolean
  classify: AbortController
  reply: AbortController
  timeout?: ReturnType<typeof setTimeout>
  replyTimeout?: ReturnType<typeof setTimeout>
}

function fallbackDelay() {
  return Number(process.env["OPENCODE_TUI_AUTO_APPROVE_FALLBACK_MS"]) || 18_000
}

// A reply already on the wire is given its own, longer grace period: the classify deadline
// must not yank it back (aborting cannot un-send it), but it cannot wait forever either, or a
// reply whose response never arrives would hide the permission for good.
function replyDelay() {
  return Number(process.env["OPENCODE_TUI_AUTO_APPROVE_REPLY_MS"]) || 20_000
}

export type AutoApprovalTrace = Partial<PermissionClassificationDetails> & {
  request: PermissionRequest
  /** The classifier's verdict. */
  approved: boolean
  /** The TUI replied "once" on the user's behalf, so this action ran without ever being shown. */
  applied?: boolean
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
      auto_approve: {
        [requestID: string]: AutoApprovalTrace
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
      auto_approve: {},
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
    const syncingSessions = new Map<string, Promise<void>>()
    const hydratingSessions = new Map<string, { messages: Set<string>; parts: Set<string> }>()
    const autoApprovals = new Map<string, AutoApprovalAttempt>()
    const permissionVisible = new Set<(request: PermissionRequest) => void>()
    function announce(request: PermissionRequest) {
      // Handlers are plugin-supplied; one that throws must not abort the rest of this
      // event handler, which is in the middle of applying server state.
      for (const handler of permissionVisible) {
        try {
          handler(request)
        } catch {}
      }
    }
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

    function upsertPermission(request: PermissionRequest) {
      const requests = store.permission[request.sessionID]
      if (!requests) {
        setStore("permission", request.sessionID, [request])
        announce(request)
        return
      }
      const match = search(requests, request.id, (item) => item.id)
      if (match.found) {
        setStore("permission", request.sessionID, match.index, reconcile(request))
        return
      }
      announce(request)
      setStore(
        "permission",
        request.sessionID,
        produce((draft) => {
          draft.splice(match.index, 0, request)
        }),
      )
    }

    function releaseAttempt(attempt: AutoApprovalAttempt) {
      if (autoApprovals.get(attempt.request.id) === attempt) autoApprovals.delete(attempt.request.id)
    }

    function resolveAttempt(attempt: AutoApprovalAttempt) {
      attempt.resolved = true
      clearTimeout(attempt.timeout)
      clearTimeout(attempt.replyTimeout)
      releaseAttempt(attempt)
    }

    function fallbackPermission(attempt: AutoApprovalAttempt) {
      // Aborting a reply already on the wire cannot un-send it, so a dialog here would
      // prompt for an action the server may have run.
      if (attempt.resolved || attempt.recovered || attempt.replying) return
      attempt.recovered = true
      clearTimeout(attempt.timeout)
      clearTimeout(attempt.replyTimeout)
      attempt.classify.abort()
      releaseAttempt(attempt)
      upsertPermission(attempt.request)
    }

    function invalidatePermission(attempt: AutoApprovalAttempt) {
      attempt.recovered = true
      clearTimeout(attempt.timeout)
      clearTimeout(attempt.replyTimeout)
      attempt.classify.abort()
      attempt.reply.abort()
    }

    createEffect(() => {
      const mode = permission.mode
      permission.revision
      if (mode === "review") return
      for (const attempt of autoApprovals.values()) fallbackPermission(attempt)
    })

    event.subscribe((event, { directory, workspace }) => {
      switch (event.type) {
        case "server.instance.disposed": {
          const disposed = event.properties.directory
          for (const attempt of [...autoApprovals.values()]) {
            // Only the disposed instance forgot its pending requests. Attempts against a
            // live instance still need an answer, so hand those back to the normal dialog.
            if (attempt.directory === disposed) invalidatePermission(attempt)
            else fallbackPermission(attempt)
          }
          autoApprovals.clear()
          // reconcile, not a bare object: setStore merges plain objects, so `{}` would keep every trace.
          setStore("auto_approve", reconcile({}))
          void bootstrap()
          break
        }
        case "permission.replied": {
          const attempt = autoApprovals.get(event.properties.requestID)
          if (attempt) {
            attempt.resolved = true
            clearTimeout(attempt.timeout)
            attempt.classify.abort()
            attempt.reply.abort()
            autoApprovals.delete(event.properties.requestID)
          }
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
          if (permission.mode === "review") {
            const requests = store.permission[request.sessionID]
            if (requests && search(requests, request.id, (item) => item.id).found) {
              upsertPermission(request)
              break
            }
            if (autoApprovals.has(request.id)) break
            const attempt: AutoApprovalAttempt = {
              request,
              directory,
              revision: permission.revision,
              resolved: false,
              recovered: false,
              replying: false,
              classify: new AbortController(),
              reply: new AbortController(),
            }
            attempt.timeout = setTimeout(() => fallbackPermission(attempt), fallbackDelay())
            autoApprovals.set(request.id, attempt)
            void sdk.client.permission
              .classify({ requestID: request.id, directory, workspace }, { signal: attempt.classify.signal })
              .then((result) => {
                const decision = result.data?.approved === true
                // The audit trail is not opt-in: show_details controls only the classifier
                // input/output, never whether the decision itself is recorded.
                if (decision || result.data?.details) {
                  setStore("auto_approve", request.id, {
                    request,
                    approved: decision,
                    ...(result.data?.details ?? {}),
                  })
                }
                if (
                  attempt.resolved ||
                  attempt.recovered ||
                  permission.mode !== "review" ||
                  permission.revision !== attempt.revision
                ) {
                  fallbackPermission(attempt)
                  return
                }
                if (result.data?.approved !== true) {
                  fallbackPermission(attempt)
                  return
                }
                attempt.replying = true
                // The `replying` guard must not outlive the request itself: a reply whose
                // response never arrives would otherwise hold the permission hidden forever,
                // which strands the agent worse than a redundant dialog does.
                // Recover from the timer itself rather than relying on the abort: a transport
                // that never settles never observes the signal.
                attempt.replyTimeout = setTimeout(() => {
                  attempt.replying = false
                  attempt.reply.abort()
                  fallbackPermission(attempt)
                }, replyDelay())
                return sdk.client.permission
                  .reply(
                    {
                      requestID: request.id,
                      reply: "once",
                      directory,
                      workspace,
                    },
                    { signal: attempt.reply.signal },
                  )
                  .then((reply) => {
                    attempt.replying = false
                    clearTimeout(attempt.replyTimeout)
                    // Release the id either way: relying on the `permission.replied` event alone
                    // leaks the entry, and the guard above would then swallow a repeated ask.
                    if (reply.data === true) {
                      if (store.auto_approve[request.id]) setStore("auto_approve", request.id, "applied", true)
                      resolveAttempt(attempt)
                      return
                    }
                    // Someone else resolved the request while our reply was in flight. It was
                    // never shown, but it was not ours to approve, so do not claim it.
                    if (attempt.resolved) {
                      resolveAttempt(attempt)
                      return
                    }
                    fallbackPermission(attempt)
                  })
              })
              .catch(() => {
                attempt.replying = false
                clearTimeout(attempt.replyTimeout)
                fallbackPermission(attempt)
              })
            break
          }
          upsertPermission(request)
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
          setStore(
            "auto_approve",
            produce((draft) => {
              for (const [id, trace] of Object.entries(draft)) {
                if (trace.request.sessionID === event.properties.info.id) delete draft[id]
              }
            }),
          )
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
          touchMessage(event.properties.info.sessionID, event.properties.info.id)
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = search(messages, messageKey(event.properties.info), messageKey)
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
              // Traces hang off a tool part; keeping them past the part they annotate would
              // grow without bound in a long session.
              setStore(
                "auto_approve",
                produce((draft) => {
                  for (const [id, trace] of Object.entries(draft)) {
                    if (trace.request.tool?.messageID === oldest.id) delete draft[id]
                  }
                }),
              )
            })
          }
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
          setStore(
            "auto_approve",
            produce((draft) => {
              for (const [id, trace] of Object.entries(draft)) {
                if (trace.request.tool?.messageID === event.properties.messageID) delete draft[id]
              }
            }),
          )
          break
        }
        case "message.part.updated": {
          touchPart(event.properties.part.sessionID, event.properties.part.id)
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            break
          }
          const result = search(parts, event.properties.part.id, (part) => part.id)
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

    const autoApproveIndex = createMemo(() => {
      const index = new Map<string, AutoApprovalTrace>()
      for (const trace of Object.values(store.auto_approve)) {
        if (!trace.request.tool) continue
        index.set(`${trace.request.tool.messageID} ${trace.request.tool.callID}`, trace)
      }
      return index
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
          const syncing = syncingSessions.get(sessionID)
          if (syncing) return syncing
          const tracker = { messages: new Set<string>(), parts: new Set<string>() }
          hydratingSessions.set(sessionID, tracker)
          const task = (async () => {
            const [session, messages, todo, diff] = await Promise.all([
              sdk.client.session.get({ sessionID }, { throwOnError: true }),
              sdk.client.session.messages({ sessionID, limit: 100 }),
              sdk.client.session.todo({ sessionID }),
              sdk.client.session.diff({ sessionID }),
            ])
            setStore(
              produce((draft) => {
                const match = search(draft.session, sessionID, (s) => s.id)
                if (match.found) draft.session[match.index] = session.data!
                if (!match.found) draft.session.splice(match.index, 0, session.data!)
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
                infos.sort(compareMessage)
                const removed = infos.slice(0, -100)
                const visible = infos.slice(-100)
                const visibleIDs = new Set(visible.map((message) => message.id))
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
          })().finally(() => {
            syncingSessions.delete(sessionID)
            hydratingSessions.delete(sessionID)
          })
          syncingSessions.set(sessionID, task)
          return task
        },
      },
      autoApprove: {
        get(messageID: string, callID: string) {
          return autoApproveIndex().get(`${messageID} ${callID}`)
        },
      },
      permission: {
        /**
         * Fires once per request at the moment it actually reaches the user. Distinct from the
         * `permission.asked` event: auto-approve mode withholds a request while a model reviews
         * it, and never shows the ones it approves.
         */
        onVisible(handler: (request: PermissionRequest) => void) {
          permissionVisible.add(handler)
          return () => permissionVisible.delete(handler)
        },
      },
      bootstrap,
    }
    return result
  },
})

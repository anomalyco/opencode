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
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@opencode-ai/util/binary"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onMount } from "solid-js"
import { Log } from "@/util/log"
import type { Path } from "@opencode-ai/sdk"
import { parseLinkHeader } from "@/util/link-header"
import { evictFromEnd, evictFromStart, paginationError, windowNewest, windowOldest } from "@tui/util/pagination"

/** Maximum messages kept in memory per session */
const MAX_LOADED_MESSAGES = 500

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
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
      message_page: {
        [sessionID: string]: {
          hasOlder: boolean
          hasNewer: boolean
          loading: boolean
          loadingDirection?: "older" | "newer"
          oldest?: string
          newest?: string
          error?: string
        }
      }
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: Snapshot.FileDiff[]
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
      path: Path
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
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
      message_page: {},
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
      path: { state: "", config: "", worktree: "", directory: "" },
    })

    const sdk = useSDK()

    const getRevertMarker = (sessionID: string) => {
      const match = Binary.search(store.session, sessionID, (s) => s.id)
      if (!match.found) return undefined
      return store.session[match.index].revert?.messageID
    }

    sdk.event.listen((e) => {
      const event = e.details
      switch (event.type) {
        case "server.instance.disposed":
          bootstrap()
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
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
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
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
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
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
          const match = Binary.search(requests, request.id, (r) => r.id)
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
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
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
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
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

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "message.updated": {
          const sessionID = event.properties.info.sessionID
          const page = store.message_page[sessionID]
          const messages = store.message[sessionID]
          const pinned = getRevertMarker(sessionID)
          if (!messages) {
            setStore("message", sessionID, [event.properties.info])
            break
          }
          const result = Binary.search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", sessionID, result.index, reconcile(event.properties.info))
            break
          }
          const loadingNewer = page?.loading && page.loadingDirection === "newer"
          const loadingOlder = page?.loading && page.loadingDirection === "older"
          if (page?.hasNewer && !loadingNewer) {
            break
          }
          if (page?.oldest && event.properties.info.id < page.oldest && !loadingOlder) {
            break
          }
          setStore(
            "message",
            sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          const updated = store.message[event.properties.info.sessionID]
          if (page) {
            const nextOldest = windowOldest(updated, pinned) ?? page.oldest
            const nextNewest = windowNewest(updated, pinned) ?? page.newest
            setStore("message_page", event.properties.info.sessionID, {
              ...page,
              newest: nextNewest,
              oldest: nextOldest,
            })
          }
          if (updated.length > MAX_LOADED_MESSAGES) {
            const evictCount = updated.length - MAX_LOADED_MESSAGES
            const preview = [...updated]
            const evicted = evictFromStart(preview, evictCount, pinned)
            const nextOldest = windowOldest(preview, pinned) ?? page?.oldest
            const nextNewest = windowNewest(preview, pinned) ?? page?.newest
            batch(() => {
              setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft) => {
                  evictFromStart(draft, evictCount, pinned)
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  for (const msg of evicted) {
                    delete draft[msg.id]
                  }
                }),
              )
              if (page) {
                setStore("message_page", event.properties.info.sessionID, {
                  ...page,
                  hasOlder: true,
                  oldest: nextOldest,
                  newest: nextNewest,
                })
              }
            })
          }
          break
        }
        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
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
          const sessionID = event.properties.part.sessionID
          const page = store.message_page[sessionID]
          const messages = store.message[sessionID]
          const messageExists = messages?.some((m) => m.id === event.properties.part.messageID)
          const loadingNewer = page?.loading && page.loadingDirection === "newer"
          if (!messageExists && !loadingNewer) {
            break
          }
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            break
          }
          const result = Binary.search(parts, event.properties.part.id, (p) => p.id)
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
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (!result.found) break
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
          const parts = store.part[event.properties.messageID]
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (result.found)
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          break
        }

        case "lsp.updated": {
          sdk.client.lsp.status().then((x) => setStore("lsp", x.data!))
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap() {
      console.log("bootstrapping")
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000
      const sessionListPromise = sdk.client.session
        .list({ start: start, roots: true })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))

      // blocking - include session.list when continuing a session
      const providersPromise = sdk.client.config.providers({}, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({}, { throwOnError: true })
      const agentsPromise = sdk.client.app.agents({}, { throwOnError: true })
      const configPromise = sdk.client.config.get({}, { throwOnError: true })
      const blockingRequests: Promise<unknown>[] = [
        providersPromise,
        providerListPromise,
        agentsPromise,
        configPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ]

      await Promise.all(blockingRequests)
        .then(() => {
          const providersResponse = providersPromise.then((x) => x.data!)
          const providerListResponse = providerListPromise.then((x) => x.data!)
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data!)
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          return Promise.all([
            providersResponse,
            providerListResponse,
            agentsResponse,
            configResponse,
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const providers = responses[0]
            const providerList = responses[1]
            const agents = responses[2]
            const config = responses[3]
            const sessions = responses[4]

            batch(() => {
              setStore("provider", reconcile(providers.providers))
              setStore("provider_default", reconcile(providers.default))
              setStore("provider_next", reconcile(providerList))
              setStore("agent", reconcile(agents))
              setStore("config", reconcile(config))
              if (sessions !== undefined) setStore("session", reconcile(sessions))
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          Promise.all([
            ...(args.continue ? [] : [sessionListPromise.then((sessions) => setStore("session", reconcile(sessions)))]),
            sdk.client.command.list().then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status().then((x) => setStore("lsp", reconcile(x.data!))),
            sdk.client.mcp.status().then((x) => setStore("mcp", reconcile(x.data!))),
            sdk.client.experimental.resource.list().then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status().then((x) => setStore("formatter", reconcile(x.data!))),
            sdk.client.session.status().then((x) => {
              setStore("session_status", reconcile(x.data!))
            }),
            sdk.client.provider.auth().then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get().then((x) => setStore("vcs", reconcile(x.data))),
            sdk.client.path.get().then((x) => setStore("path", reconcile(x.data!))),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          Log.Default.error("tui bootstrap failed", {
            error: paginationError(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          await exit(e)
        })
    }

    onMount(() => {
      bootstrap()
    })

    const fullSyncedSessions = new Set<string>()
    const treeSyncedRoots = new Set<string>()
    const loadingGuard = new Set<string>()
    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        return store.status !== "loading"
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
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
          const [session, messages, todo, diff] = await Promise.all([
            sdk.client.session.get({ sessionID }, { throwOnError: true }),
            sdk.client.session.messages({ sessionID, limit: 100 }),
            sdk.client.session.todo({ sessionID }),
            sdk.client.session.diff({ sessionID }),
          ])
          const link = messages.response.headers.get("link") ?? ""
          const hasOlder = parseLinkHeader(link).prev !== undefined
          const pageMessages = messages.data ?? []
          const oldest = pageMessages.at(0)?.info.id
          const newest = pageMessages.at(-1)?.info.id
          const revertMessageID = session.data?.revert?.messageID
          const mergedMessages = await (async () => {
            if (!revertMessageID) return pageMessages
            if (pageMessages.some((m) => m.info.id === revertMessageID)) return pageMessages
            try {
              const revertResult = await sdk.client.session.message(
                { sessionID, messageID: revertMessageID },
                { throwOnError: true },
              )
              if (revertResult.data) return [revertResult.data, ...pageMessages]
            } catch (e) {
              Log.Default.info("Revert marker fetch failed during sync", {
                messageID: revertMessageID,
                error: e,
              })
            }
            return pageMessages
          })()
          const nextOldest = oldest ?? mergedMessages.at(0)?.info.id
          const nextNewest = newest ?? mergedMessages.at(-1)?.info.id
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session[match.index] = session.data!
              if (!match.found) draft.session.splice(match.index, 0, session.data!)
              draft.todo[sessionID] = todo.data ?? []
              draft.message[sessionID] = mergedMessages.map((x) => x.info)
              for (const message of mergedMessages) {
                draft.part[message.info.id] = message.parts
              }
              draft.session_diff[sessionID] = diff.data ?? []
              draft.message_page[sessionID] = {
                hasOlder,
                hasNewer: false,
                loading: false,
                oldest: nextOldest,
                newest: nextNewest,
                error: undefined,
              }
            }),
          )
          fullSyncedSessions.add(sessionID)
        },
        async syncTree(sessionID: string) {
          // Walk up to find the root session
          let rootID = sessionID
          const visited = new Set<string>()
          while (true) {
            if (visited.has(rootID)) break
            visited.add(rootID)
            const match = Binary.search(store.session, rootID, (s) => s.id)
            if (!match.found) break
            const parentID = store.session[match.index].parentID
            if (!parentID) break
            const parentMatch = Binary.search(store.session, parentID, (s) => s.id)
            if (parentMatch.found) {
              rootID = parentID
              continue
            }
            // Parent not in store — fetch it
            const res = await sdk.client.session.get({ sessionID: parentID }).catch(() => undefined)
            if (!res?.data) break
            setStore(
              produce((draft) => {
                const idx = Binary.search(draft.session, res.data!.id, (s) => s.id)
                if (!idx.found) draft.session.splice(idx.index, 0, res.data!)
              }),
            )
            rootID = parentID
          }

          if (treeSyncedRoots.has(rootID)) return
          treeSyncedRoots.add(rootID)

          // BFS from root — load all descendants level by level
          const queue = [rootID]
          while (queue.length > 0) {
            const level = [...queue]
            queue.length = 0
            const results = await Promise.all(
              level.map((id) => sdk.client.session.children({ sessionID: id }).catch(() => undefined)),
            )
            const all = results.flatMap((r) => r?.data ?? [])
            if (all.length === 0) break
            setStore(
              produce((draft) => {
                for (const child of all) {
                  const idx = Binary.search(draft.session, child.id, (s) => s.id)
                  if (!idx.found) draft.session.splice(idx.index, 0, child)
                }
              }),
            )
            for (const child of all) {
              queue.push(child.id)
            }
          }
        },
        async loadOlder(sessionID: string) {
          const page = store.message_page[sessionID]
          if (page?.loading || !page?.hasOlder) return
          const messages = store.message[sessionID] ?? []
          const cursor = page?.oldest ?? messages.at(0)?.id
          if (!cursor) return
          if (loadingGuard.has(sessionID)) return
          loadingGuard.add(sessionID)
          const pinned = getRevertMarker(sessionID)
          try {
            setStore("message_page", sessionID, { ...page, loading: true, loadingDirection: "older", error: undefined })

            const res = await sdk.client.session.messages(
              { sessionID, before: cursor, limit: 100 },
              { throwOnError: true },
            )
            const link = res.response.headers.get("link") ?? ""
            const hasOlder = parseLinkHeader(link).prev !== undefined
            setStore(
              produce((draft) => {
                const existing = draft.message[sessionID] ?? []
                const pageOldest = res.data?.at(0)?.info.id
                for (const msg of res.data ?? []) {
                  const match = Binary.search(existing, msg.info.id, (m) => m.id)
                  if (!match.found) {
                    existing.splice(match.index, 0, msg.info)
                    draft.part[msg.info.id] = msg.parts
                  }
                }
                const nextOldest = pageOldest ?? draft.message_page[sessionID]?.oldest
                if (existing.length > MAX_LOADED_MESSAGES) {
                  const evictCount = existing.length - MAX_LOADED_MESSAGES
                  const evicted = evictFromEnd(existing, evictCount, pinned)
                  for (const msg of evicted) delete draft.part[msg.id]
                  const nextNewest = windowNewest(existing, pinned) ?? draft.message_page[sessionID]?.newest
                  draft.message_page[sessionID] = {
                    hasOlder,
                    hasNewer: true,
                    loading: false,
                    oldest: nextOldest,
                    newest: nextNewest,
                    error: undefined,
                  }
                } else {
                  const nextNewest = windowNewest(existing, pinned) ?? draft.message_page[sessionID]?.newest
                  draft.message_page[sessionID] = {
                    hasOlder,
                    hasNewer: draft.message_page[sessionID]?.hasNewer ?? false,
                    loading: false,
                    oldest: nextOldest,
                    newest: nextNewest,
                    error: undefined,
                  }
                }
              }),
            )
          } catch (e) {
            const page = store.message_page[sessionID]
            setStore("message_page", sessionID, {
              hasOlder: page?.hasOlder ?? false,
              hasNewer: page?.hasNewer ?? false,
              loading: false,
              oldest: page?.oldest,
              newest: page?.newest,
              error: paginationError(e),
            })
          } finally {
            loadingGuard.delete(sessionID)
          }
        },
        async loadNewer(sessionID: string) {
          const page = store.message_page[sessionID]
          if (page?.loading || !page?.hasNewer) return
          const messages = store.message[sessionID] ?? []
          const cursor = page?.newest ?? messages.at(-1)?.id
          if (!cursor) return
          if (loadingGuard.has(sessionID)) return
          loadingGuard.add(sessionID)
          const pinned = getRevertMarker(sessionID)
          try {
            setStore("message_page", sessionID, { ...page, loading: true, loadingDirection: "newer", error: undefined })
            const res = await sdk.client.session.messages(
              { sessionID, after: cursor, limit: 100 },
              { throwOnError: true },
            )
            const link = res.response.headers.get("link") ?? ""
            const hasNewer = parseLinkHeader(link).next !== undefined
            setStore(
              produce((draft) => {
                const existing = draft.message[sessionID] ?? []
                const pageNewest = res.data?.at(-1)?.info.id
                for (const msg of res.data ?? []) {
                  const match = Binary.search(existing, msg.info.id, (m) => m.id)
                  if (!match.found) {
                    existing.splice(match.index, 0, msg.info)
                    draft.part[msg.info.id] = msg.parts
                  }
                }
                const nextNewest = pageNewest ?? draft.message_page[sessionID]?.newest
                if (existing.length > MAX_LOADED_MESSAGES) {
                  const evictCount = existing.length - MAX_LOADED_MESSAGES
                  const evicted = evictFromStart(existing, evictCount, pinned)
                  for (const msg of evicted) delete draft.part[msg.id]
                  const nextOldest = windowOldest(existing, pinned) ?? draft.message_page[sessionID]?.oldest
                  draft.message_page[sessionID] = {
                    hasOlder: true,
                    hasNewer,
                    loading: false,
                    oldest: nextOldest,
                    newest: nextNewest,
                    error: undefined,
                  }
                } else {
                  const nextOldest = windowOldest(existing, pinned) ?? draft.message_page[sessionID]?.oldest
                  draft.message_page[sessionID] = {
                    hasOlder: draft.message_page[sessionID]?.hasOlder ?? false,
                    hasNewer,
                    loading: false,
                    oldest: nextOldest,
                    newest: nextNewest,
                    error: undefined,
                  }
                }
              }),
            )
          } catch (e) {
            const page = store.message_page[sessionID]
            setStore("message_page", sessionID, {
              hasOlder: page?.hasOlder ?? false,
              hasNewer: page?.hasNewer ?? false,
              loading: false,
              oldest: page?.oldest,
              newest: page?.newest,
              error: paginationError(e),
            })
          } finally {
            loadingGuard.delete(sessionID)
          }
        },
        async jumpToLatest(sessionID: string) {
          const page = store.message_page[sessionID]
          if (page?.loading || !page?.hasNewer) return
          if (loadingGuard.has(sessionID)) return
          loadingGuard.add(sessionID)

          try {
            // Check for revert state
            const session = store.session.find((s) => s.id === sessionID)
            const revertMessageID = session?.revert?.messageID

            setStore("message_page", sessionID, {
              ...page,
              loading: true,
              loadingDirection: "newer",
              error: undefined,
            })

            // Fetch newest page (no cursor = newest)
            const res = await sdk.client.session.messages({ sessionID, limit: 100 }, { throwOnError: true })

            let messages = res.data ?? []
            const pageOldest = messages.at(0)?.info.id
            const pageNewest = messages.at(-1)?.info.id
            const link = res.response.headers.get("link") ?? ""
            const hasOlder = parseLinkHeader(link).prev !== undefined

            // Revert-aware: If in revert state and marker not in results, fetch it
            if (revertMessageID && !messages.some((m) => m.info.id === revertMessageID)) {
              try {
                const revertResult = await sdk.client.session.message(
                  { sessionID, messageID: revertMessageID },
                  { throwOnError: true },
                )
                if (revertResult.data) {
                  // Prepend revert message (it's older than newest page)
                  messages = [revertResult.data, ...messages]
                }
              } catch (e) {
                // Revert message may have been deleted, continue without it
                Log.Default.info("Revert marker fetch failed (may be deleted)", {
                  messageID: revertMessageID,
                  error: e,
                })
              }
            }

            const nextOldest = pageOldest ?? messages.at(0)?.info.id
            const nextNewest = pageNewest ?? messages.at(-1)?.info.id

            setStore(
              produce((draft) => {
                // Clean up parts only for messages not in new results
                const oldMessages = draft.message[sessionID] ?? []
                const newIds = new Set(messages.map((m) => m.info.id))
                for (const msg of oldMessages) {
                  if (!newIds.has(msg.id)) {
                    delete draft.part[msg.id]
                  }
                }

                // Store new messages
                draft.message[sessionID] = messages.map((m) => m.info)
                for (const msg of messages) {
                  draft.part[msg.info.id] = msg.parts
                }
                draft.message_page[sessionID] = {
                  hasOlder,
                  hasNewer: false,
                  loading: false,
                  oldest: nextOldest,
                  newest: nextNewest,
                  error: undefined,
                }
              }),
            )
          } catch (e) {
            setStore(
              produce((draft) => {
                const p = draft.message_page[sessionID]
                if (p) {
                  p.loading = false
                  p.error = paginationError(e)
                }
              }),
            )
          } finally {
            loadingGuard.delete(sessionID)
          }
        },
        async jumpToOldest(sessionID: string) {
          const page = store.message_page[sessionID]
          if (page?.loading || !page?.hasOlder) return
          if (loadingGuard.has(sessionID)) return
          loadingGuard.add(sessionID)

          try {
            setStore("message_page", sessionID, {
              ...page,
              loading: true,
              loadingDirection: "older",
              error: undefined,
            })

            const res = await sdk.client.session.messages(
              { sessionID, oldest: "true", limit: 100 },
              { throwOnError: true },
            )

            const session = store.session.find((s) => s.id === sessionID)
            const revertMessageID = session?.revert?.messageID

            let messages = res.data ?? []
            const pageOldest = messages.at(0)?.info.id
            const pageNewest = messages.at(-1)?.info.id
            const link = res.response.headers.get("link") ?? ""
            const hasNewer = parseLinkHeader(link).next !== undefined

            if (revertMessageID && !messages.some((m) => m.info.id === revertMessageID)) {
              try {
                const revertResult = await sdk.client.session.message(
                  { sessionID, messageID: revertMessageID },
                  { throwOnError: true },
                )
                if (revertResult.data) {
                  const index = Binary.search(messages, revertResult.data.info.id, (m) => m.info.id)
                  if (!index.found) messages.splice(index.index, 0, revertResult.data)
                }
              } catch (e) {
                Log.Default.info("Revert marker fetch failed during jumpToOldest", {
                  messageID: revertMessageID,
                  error: e,
                })
              }
            }

            const nextOldest = pageOldest ?? messages.at(0)?.info.id
            const nextNewest = pageNewest ?? messages.at(-1)?.info.id

            setStore(
              produce((draft) => {
                // Clean up parts only for messages not in new results
                const oldMessages = draft.message[sessionID] ?? []
                const newIds = new Set(messages.map((m) => m.info.id))
                for (const msg of oldMessages) {
                  if (!newIds.has(msg.id)) {
                    delete draft.part[msg.id]
                  }
                }

                // Store new messages
                draft.message[sessionID] = messages.map((m) => m.info)
                for (const msg of messages) {
                  draft.part[msg.info.id] = msg.parts
                }
                draft.message_page[sessionID] = {
                  hasOlder: false,
                  hasNewer,
                  loading: false,
                  oldest: nextOldest,
                  newest: nextNewest,
                  error: undefined,
                }
              }),
            )
          } catch (e) {
            setStore(
              produce((draft) => {
                const p = draft.message_page[sessionID]
                if (p) {
                  p.loading = false
                  p.error = paginationError(e)
                }
              }),
            )
          } finally {
            loadingGuard.delete(sessionID)
          }
        },
      },
      bootstrap,
    }
    return result
  },
})

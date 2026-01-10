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

// Collaboration types (inline until SDK is regenerated)
export namespace CollaborationTypes {
  export type Role = "driver" | "participant"

  export type Participant = {
    id: string
    sessionID: string
    name: string
    role: Role
    color?: string
    time: {
      joined: number
      lastSeen: number
    }
  }

  export type TypingStatus = {
    participantID: string
    sessionID: string
    isTyping: boolean
    preview?: string
    time: number
  }

  export type QueuedMessage = {
    id: string
    sessionID: string
    participantID: string
    participantName: string
    text: string
    directives: Array<{
      type: "mention" | "wait"
      target: string
      resolved: boolean
    }>
    time: { queued: number }
    attachments?: unknown[]
  }

  export type PendingWait = {
    target: string
    waitingFor: string[]
    triggeredBy: string
  }

  export type JoinCode = {
    code: string
    sessionID: string
    createdBy: string
    time: { created: number; expires: number }
  }

  export type SessionState = {
    participants: Record<string, Participant>
    typingStatuses: Record<string, TypingStatus>
    messageQueue: QueuedMessage[]
    pendingWaits: PendingWait[]
    waitingFor: string[]
    joinCode: JoinCode | null
    myParticipantID: string | null
  }
}

function getWaitingForNames(state: CollaborationTypes.SessionState): string[] {
  const ids = new Set<string>()
  for (const wait of state.pendingWaits ?? []) {
    for (const id of wait.waitingFor ?? []) {
      ids.add(id)
    }
  }
  return Array.from(ids)
    .map((id) => state.participants[id]?.name)
    .filter((name): name is string => !!name)
}
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
      collaboration: {
        [sessionID: string]: CollaborationTypes.SessionState
      }
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
      collaboration: {},
    })

    const sdk = useSDK()

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
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = Binary.search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
              if (draft.length > 100) draft.shift()
            }),
          )
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

      // Collaboration events (handled separately since SDK types haven't been regenerated)
      const eventType = event.type as string
      const eventProps = (event as { properties: unknown }).properties as Record<string, unknown>

      // Debug: log collaboration events
      if (eventType.startsWith("collaboration.")) {
        console.log("[COLLAB EVENT]", eventType, JSON.stringify(eventProps, null, 2))
      }

      switch (eventType) {
        case "collaboration.participant.joined": {
          const { sessionID, participant } = eventProps as {
            sessionID: string
            participant: CollaborationTypes.Participant
          }
          // Ensure collaboration state exists for this session
          if (!store.collaboration[sessionID]) {
            setStore("collaboration", sessionID, {
              participants: {},
              typingStatuses: {},
              messageQueue: [],
              pendingWaits: [],
              waitingFor: [],
              joinCode: null,
              myParticipantID: null,
            })
          }
          setStore("collaboration", sessionID, "participants", participant.id, participant)
          break
        }

        case "collaboration.participant.left": {
          const { sessionID, participantID } = eventProps as {
            sessionID: string
            participantID: string
          }
          if (!store.collaboration[sessionID]) break
          setStore(
            "collaboration",
            sessionID,
            "participants",
            produce((draft) => {
              delete draft[participantID]
            }),
          )
          setStore(
            "collaboration",
            sessionID,
            "typingStatuses",
            produce((draft) => {
              delete draft[participantID]
            }),
          )
          break
        }

        case "collaboration.participant.updated": {
          const { sessionID, participant } = eventProps as {
            sessionID: string
            participant: CollaborationTypes.Participant
          }
          if (!store.collaboration[sessionID]) break
          setStore("collaboration", sessionID, "participants", participant.id, reconcile(participant))
          break
        }

        case "collaboration.typing.changed": {
          const status = eventProps as unknown as CollaborationTypes.TypingStatus
          if (!store.collaboration[status.sessionID]) break
          if (status.isTyping) {
            setStore("collaboration", status.sessionID, "typingStatuses", status.participantID, status)
          } else {
            setStore(
              "collaboration",
              status.sessionID,
              "typingStatuses",
              produce((draft) => {
                delete draft[status.participantID]
              }),
            )
          }
          break
        }

        case "collaboration.message.queued": {
          const { sessionID, message } = eventProps as {
            sessionID: string
            message: CollaborationTypes.QueuedMessage
          }
          if (!store.collaboration[sessionID]) break
          // Check for duplicate (same message ID already in queue)
          const existingQueue = store.collaboration[sessionID]?.messageQueue ?? []
          if (existingQueue.some((m) => m.id === message.id)) {
            console.log("[COLLAB] Ignoring duplicate message:", message.id)
            break
          }
          setStore(
            "collaboration",
            sessionID,
            "messageQueue",
            produce((draft) => {
              draft.push(message)
            }),
          )
          break
        }

        case "collaboration.queue.flushed": {
          const { sessionID, messageCount } = eventProps as { sessionID: string; messageCount: number }
          console.log("[SSE] QueueFlushed received for session:", sessionID, "count:", messageCount)
          if (!store.collaboration[sessionID]) {
            console.log("[SSE] No collaboration state for session, skipping")
            break
          }
          console.log("[SSE] Queue before SSE clear:", store.collaboration[sessionID]?.messageQueue?.length)
          // Use direct replacement (not `reconcile([])`) so Solid sees the array reference change and <For> clears.
          setStore("collaboration", sessionID, "messageQueue", [])
          setStore("collaboration", sessionID, "pendingWaits", [])
          setStore("collaboration", sessionID, "waitingFor", [])
          console.log("[SSE] Queue after SSE clear:", store.collaboration[sessionID]?.messageQueue?.length)
          break
        }

        case "collaboration.waiting.for": {
          const { sessionID, waitingFor } = eventProps as {
            sessionID: string
            waitingFor: string[]
          }
          if (!store.collaboration[sessionID]) break
          setStore("collaboration", sessionID, "waitingFor", waitingFor)
          break
        }

        case "collaboration.joincode.created": {
          const { sessionID, code } = eventProps as { sessionID: string; code: string }
          if (!store.collaboration[sessionID]) break
          // Store the code with formatted version
          setStore("collaboration", sessionID, "joinCode", {
            code,
            sessionID,
            createdBy: "",
            time: { created: Date.now(), expires: Date.now() + 24 * 60 * 60 * 1000 },
          })
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
        .list({ start: start })
        .then((x) => setStore("session", reconcile((x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))))

      // blocking - include session.list when continuing a session
      const blockingRequests: Promise<unknown>[] = [
        sdk.client.config.providers({}, { throwOnError: true }).then((x) => {
          batch(() => {
            setStore("provider", reconcile(x.data!.providers))
            setStore("provider_default", reconcile(x.data!.default))
          })
        }),
        sdk.client.provider.list({}, { throwOnError: true }).then((x) => {
          batch(() => {
            setStore("provider_next", reconcile(x.data!))
          })
        }),
        sdk.client.app.agents({}, { throwOnError: true }).then((x) => setStore("agent", reconcile(x.data ?? []))),
        sdk.client.config.get({}, { throwOnError: true }).then((x) => setStore("config", reconcile(x.data!))),
        ...(args.continue ? [sessionListPromise] : []),
      ]

      await Promise.all(blockingRequests)
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          Promise.all([
            ...(args.continue ? [] : [sessionListPromise]),
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
            error: e instanceof Error ? e.message : String(e),
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
          const [session, messages, todo, diff, collaboration] = await Promise.all([
            sdk.client.session.get({ sessionID }, { throwOnError: true }),
            sdk.client.session.messages({ sessionID, limit: 100 }),
            sdk.client.session.todo({ sessionID }),
            sdk.client.session.diff({ sessionID }),
            // Fetch collaboration state
            fetch(`${sdk.url}/session/${sessionID}/collaboration`)
              .then((r) => r.json())
              .catch(() => null) as Promise<CollaborationTypes.SessionState | null>,
          ])
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session[match.index] = session.data!
              if (!match.found) draft.session.splice(match.index, 0, session.data!)
              draft.todo[sessionID] = todo.data ?? []
              draft.message[sessionID] = messages.data!.map((x) => x.info)
              for (const message of messages.data!) {
                draft.part[message.info.id] = message.parts
              }
              draft.session_diff[sessionID] = diff.data ?? []
              // Set collaboration state if there are participants
              if (collaboration && Object.keys(collaboration.participants || {}).length > 0) {
                draft.collaboration[sessionID] = {
                  participants: collaboration.participants ?? {},
                  typingStatuses: collaboration.typingStatuses ?? {},
                  messageQueue: collaboration.messageQueue ?? [],
                  pendingWaits: collaboration.pendingWaits ?? [],
                  waitingFor: getWaitingForNames({
                    participants: collaboration.participants ?? {},
                    typingStatuses: collaboration.typingStatuses ?? {},
                    messageQueue: collaboration.messageQueue ?? [],
                    pendingWaits: collaboration.pendingWaits ?? [],
                    waitingFor: [],
                    joinCode: collaboration.joinCode ?? null,
                    myParticipantID: null,
                  }),
                  joinCode: collaboration.joinCode ?? null,
                  myParticipantID: null,
                }
              }
            }),
          )
          fullSyncedSessions.add(sessionID)
        },
      },
      bootstrap,
    }
    return result
  },
})

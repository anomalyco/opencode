import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  PlanEntry,
  Command,
  Permission,
  LspStatus,
  McpStatus,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  Workspace,
  Project,
} from "@forge/sdk"
import { createStore, produce, reconcile } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@forge/util/binary"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { batch, onMount } from "solid-js"

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
        [sessionID: string]: Permission[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: Snapshot.FileDiff[]
      }
      plan: {
        [sessionID: string]: PlanEntry[]
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
      formatter: FormatterStatus[]
      workspace: Workspace[]
      project: Project | null
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
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      plan: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      formatter: [],
      workspace: [],
      project: null,
    })

    const sdk = useSDK()

    sdk.event.listen((e) => {
      const event = e.details
      switch (event.type) {
        case "permission.updated": {
          const permissions = store.permission[event.properties.sessionID]
          if (!permissions) {
            setStore("permission", event.properties.sessionID, [event.properties])
            break
          }
          const match = Binary.search(permissions, event.properties.id, (p) => p.id)
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              if (match.found) {
                draft[match.index] = event.properties
                return
              }
              draft.push(event.properties)
            }),
          )
          break
        }

        case "permission.replied": {
          const permissions = store.permission[event.properties.sessionID]
          const match = Binary.search(permissions, event.properties.permissionID, (p) => p.id)
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

        case "plan.updated":
          setStore("plan", event.properties.sessionID, event.properties.entries)
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
        case "session.updated":
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
      }
    })

    const exit = useExit()

    async function bootstrap() {
      // blocking
      await Promise.all([
        sdk.client.config.providers({ throwOnError: true }).then((x) => {
          batch(() => {
            setStore("provider", x.data!.providers)
            setStore("provider_default", x.data!.default)
          })
        }),
        sdk.client.provider.list({ throwOnError: true }).then((x) => {
          batch(() => {
            setStore("provider_next", x.data!)
          })
        }),
        sdk.client.app.agents({ throwOnError: true }).then((x) => setStore("agent", x.data ?? [])),
        sdk.client.config.get({ throwOnError: true }).then((x) => setStore("config", x.data!)),
      ])
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          Promise.all([
            sdk.client.session.list().then((x) =>
              setStore(
                "session",
                (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)),
              ),
            ),
            sdk.client.command.list().then((x) => setStore("command", x.data ?? [])),
            sdk.client.lsp.status().then((x) => setStore("lsp", x.data!)),
            sdk.client.mcp.status().then((x) => setStore("mcp", x.data!)),
            sdk.client.formatter.status().then((x) => setStore("formatter", x.data!)),
            sdk.client.session.status().then((x) => setStore("session_status", x.data!)),
            sdk.client.provider.auth().then((x) => setStore("provider_auth", x.data ?? {})),
            // Fetch project first, then workspaces with repoID
            sdk.client.project.current().then(async (x) => {
              const project = x.data ?? null
              setStore("project", project)
              if (project?.id) {
                const workspaces = await sdk.client.workspace.list({ query: { repoID: project.id } })
                setStore("workspace", workspaces.data ?? [])
              }
            }),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          await exit(e)
        })
    }

    onMount(() => {
      bootstrap()
    })

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
          if (store.message[sessionID]) return
          const now = Date.now()
          console.log("syncing", sessionID)
          const [session, messages, plan, diff] = await Promise.all([
            sdk.client.session.get({ path: { id: sessionID }, throwOnError: true }),
            sdk.client.session.messages({ path: { id: sessionID }, query: { limit: 100 } }),
            sdk.client.session.plan({ path: { id: sessionID } }),
            sdk.client.session.diff({ path: { id: sessionID } }),
          ])
          console.log("fetched in " + (Date.now() - now), sessionID)
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session[match.index] = session.data!
              if (!match.found) draft.session.splice(match.index, 0, session.data!)
              draft.plan[sessionID] = plan.data ?? []
              draft.message[sessionID] = messages.data!.map((x) => x.info)
              for (const message of messages.data!) {
                draft.part[message.info.id] = message.parts
              }
              draft.session_diff[sessionID] = diff.data ?? []
            }),
          )
          console.log("synced in " + (Date.now() - now), sessionID)
        },
      },
      workspace: {
        get(workspaceID: string) {
          return store.workspace.find((w) => w.id === workspaceID)
        },
        /**
         * Get sessions grouped by workspace ID.
         * Sessions without a workspaceID are grouped under "main".
         */
        sessionsByWorkspace() {
          const result = new Map<string | null, Session[]>()
          result.set(null, []) // Main worktree sessions (no workspaceID)

          for (const workspace of store.workspace) {
            result.set(workspace.id, [])
          }

          for (const session of store.session) {
            const key = session.workspaceID ?? null
            if (!result.has(key)) {
              result.set(key, [])
            }
            result.get(key)!.push(session)
          }

          return result
        },
      },
      bootstrap,
    }
    return result
  },
})

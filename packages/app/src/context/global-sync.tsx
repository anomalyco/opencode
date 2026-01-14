import {
  type Message,
  type Agent,
  type Session,
  type Part,
  type Config,
  type Path,
  type Project,
  type FileDiff,
  type Todo,
  type SessionStatus,
  type ProviderListResponse,
  type ProviderAuthResponse,
  type Command,
  type McpStatus,
  type LspStatus,
  type VcsInfo,
  type PermissionRequest,
  type QuestionRequest,
  createOpencodeClient,
} from "@opencode-ai/sdk/v2/client"
import { createStore, produce, reconcile } from "solid-js/store"
import { Binary } from "@opencode-ai/util/binary"
import { retry } from "@opencode-ai/util/retry"
import { useGlobalSDK } from "./global-sdk"
import { ErrorPage, type InitError } from "../pages/error"
import { batch, createContext, useContext, onCleanup, onMount, type ParentProps, Switch, Match } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/util/path"
import { usePlatform } from "./platform"

type State = {
  status: "loading" | "partial" | "complete"
  agent: Agent[]
  command: Command[]
  project: string
  provider: ProviderListResponse
  config: Config
  path: Path
  session: Session[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: FileDiff[]
  }
  todo: {
    [sessionID: string]: Todo[]
  }
  permission: {
    [sessionID: string]: PermissionRequest[]
  }
  question: {
    [sessionID: string]: QuestionRequest[]
  }
  mcp: {
    [name: string]: McpStatus
  }
  lsp: LspStatus[]
  vcs: VcsInfo | undefined
  limit: number
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
}

function createGlobalSync() {
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const [globalStore, setGlobalStore] = createStore<{
    ready: boolean
    error?: InitError
    path: Path
    project: Project[]
    provider: ProviderListResponse
    provider_auth: ProviderAuthResponse
  }>({
    ready: false,
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    project: [],
    provider: { all: [], connected: [], default: {} },
    provider_auth: {},
  })

  const children: Record<string, ReturnType<typeof createStore<State>>> = {}
  function child(directory: string) {
    if (!directory) console.error("No directory provided")
    if (!children[directory]) {
      children[directory] = createStore<State>({
        project: "",
        provider: { all: [], connected: [], default: {} },
        config: {},
        path: { state: "", config: "", worktree: "", directory: "", home: "" },
        status: "loading" as const,
        agent: [],
        command: [],
        session: [],
        session_status: {},
        session_diff: {},
        todo: {},
        permission: {},
        question: {},
        mcp: {},
        lsp: [],
        vcs: undefined,
        limit: 5,
        message: {},
        part: {},
      })
      bootstrapInstance(directory)
    }
    return children[directory]
  }

  async function loadSessions(directory: string) {
    const [store, setStore] = child(directory)
    globalSDK.client.session
      .list({ directory })
      .then((x) => {
        const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000
        const nonArchived = (x.data ?? [])
          .filter((s) => !!s?.id)
          .filter((s) => !s.time?.archived)
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))
        // Include up to the limit, plus any updated in the last 4 hours
        const sessions = nonArchived.filter((s, i) => {
          if (i < store.limit) return true
          const updated = new Date(s.time?.updated ?? s.time?.created).getTime()
          return updated > fourHoursAgo
        })
        setStore("session", reconcile(sessions, { key: "id" }))
      })
      .catch((err) => {
        console.error("Failed to load sessions", err)
        const project = getFilename(directory)
        showToast({ title: `Failed to load sessions for ${project}`, description: err.message })
      })
  }

  async function bootstrapInstance(directory: string) {
    if (!directory) return
    const [store, setStore] = child(directory)
    const sdk = createOpencodeClient({
      baseUrl: globalSDK.url,
      fetch: platform.fetch,
      directory,
      throwOnError: true,
    })

    const blockingRequests = {
      project: () => sdk.project.current().then((x) => setStore("project", x.data!.id)),
      provider: () =>
        sdk.provider.list().then((x) => {
          const data = x.data!
          setStore("provider", {
            ...data,
            all: data.all.map((provider) => ({
              ...provider,
              models: Object.fromEntries(
                Object.entries(provider.models).filter(([, info]) => info.status !== "deprecated"),
              ),
            })),
          })
        }),
      agent: () => sdk.app.agents().then((x) => setStore("agent", x.data ?? [])),
      config: () => sdk.config.get().then((x) => setStore("config", x.data!)),
    }
    await Promise.all(Object.values(blockingRequests).map((p) => retry(p).catch((e) => setGlobalStore("error", e))))
      .then(() => {
        if (store.status !== "complete") setStore("status", "partial")
        // non-blocking
        Promise.all([
          sdk.path.get().then((x) => setStore("path", x.data!)),
          sdk.command.list().then((x) => setStore("command", x.data ?? [])),
          sdk.session.status().then((x) => setStore("session_status", x.data!)),
          loadSessions(directory),
          sdk.mcp.status().then((x) => setStore("mcp", x.data!)),
          sdk.lsp.status().then((x) => setStore("lsp", x.data!)),
          sdk.vcs.get().then((x) => setStore("vcs", x.data)),
          sdk.permission.list().then((x) => {
            const grouped: Record<string, PermissionRequest[]> = {}
            for (const perm of x.data ?? []) {
              if (!perm?.id || !perm.sessionID) continue
              const existing = grouped[perm.sessionID]
              if (existing) {
                existing.push(perm)
                continue
              }
              grouped[perm.sessionID] = [perm]
            }

            batch(() => {
              for (const sessionID of Object.keys(store.permission)) {
                if (grouped[sessionID]) continue
                setStore("permission", sessionID, [])
              }
              for (const [sessionID, permissions] of Object.entries(grouped)) {
                setStore(
                  "permission",
                  sessionID,
                  reconcile(
                    permissions
                      .filter((p) => !!p?.id)
                      .slice()
                      .sort((a, b) => a.id.localeCompare(b.id)),
                    { key: "id" },
                  ),
                )
              }
            })
          }),
          sdk.question.list().then((x) => {
            const grouped: Record<string, QuestionRequest[]> = {}
            for (const question of x.data ?? []) {
              if (!question?.id || !question.sessionID) continue
              const existing = grouped[question.sessionID]
              if (existing) {
                existing.push(question)
                continue
              }
              grouped[question.sessionID] = [question]
            }

            batch(() => {
              for (const sessionID of Object.keys(store.question)) {
                if (grouped[sessionID]) continue
                setStore("question", sessionID, [])
              }
              for (const [sessionID, questions] of Object.entries(grouped)) {
                setStore(
                  "question",
                  sessionID,
                  reconcile(
                    questions
                      .filter((q) => !!q?.id)
                      .slice()
                      .sort((a, b) => a.id.localeCompare(b.id)),
                    { key: "id" },
                  ),
                )
              }
            })
          }),
        ]).then(() => {
          setStore("status", "complete")
        })
      })
      .catch((e) => setGlobalStore("error", e))
  }

  const unsub = globalSDK.event.listen((e) => {
    const directory = e.name
    const event = e.details

    if (directory === "global") {
      switch (event?.type) {
        case "global.disposed": {
          bootstrap()
          break
        }
        case "project.updated": {
          const result = Binary.search(globalStore.project, event.properties.id, (s) => s.id)
          if (result.found) {
            setGlobalStore("project", result.index, reconcile(event.properties))
            return
          }
          setGlobalStore(
            "project",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties)
            }),
          )
          break
        }
      }
      return
    }

    const [store, setStore] = child(directory)
    switch (event.type) {
      case "server.instance.disposed": {
        bootstrapInstance(directory)
        break
      }
      case "session.updated": {
        const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
        if (event.properties.info.time.archived) {
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
      case "session.diff":
        setStore("session_diff", event.properties.sessionID, reconcile(event.properties.diff, { key: "file" }))
        break
      case "todo.updated":
        setStore("todo", event.properties.sessionID, reconcile(event.properties.todos, { key: "id" }))
        break
      case "session.status": {
        setStore("session_status", event.properties.sessionID, reconcile(event.properties.status))
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
          }),
        )
        break
      }
      case "message.removed": {
        const messages = store.message[event.properties.sessionID]
        if (!messages) break
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
        const part = event.properties.part
        const parts = store.part[part.messageID]
        if (!parts) {
          setStore("part", part.messageID, [part])
          break
        }
        const result = Binary.search(parts, part.id, (p) => p.id)
        if (result.found) {
          setStore("part", part.messageID, result.index, reconcile(part))
          break
        }
        setStore(
          "part",
          part.messageID,
          produce((draft) => {
            draft.splice(result.index, 0, part)
          }),
        )
        break
      }
      case "message.part.removed": {
        const parts = store.part[event.properties.messageID]
        if (!parts) break
        const result = Binary.search(parts, event.properties.partID, (p) => p.id)
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
      case "vcs.branch.updated": {
        setStore("vcs", { branch: event.properties.branch })
        break
      }
      case "permission.asked": {
        const sessionID = event.properties.sessionID
        const permissions = store.permission[sessionID]
        if (!permissions) {
          setStore("permission", sessionID, [event.properties])
          break
        }

        const result = Binary.search(permissions, event.properties.id, (p) => p.id)
        if (result.found) {
          setStore("permission", sessionID, result.index, reconcile(event.properties))
          break
        }

        setStore(
          "permission",
          sessionID,
          produce((draft) => {
            draft.splice(result.index, 0, event.properties)
          }),
        )
        break
      }
      case "permission.replied": {
        const permissions = store.permission[event.properties.sessionID]
        if (!permissions) break
        const result = Binary.search(permissions, event.properties.requestID, (p) => p.id)
        if (!result.found) break
        setStore(
          "permission",
          event.properties.sessionID,
          produce((draft) => {
            draft.splice(result.index, 1)
          }),
        )
        break
      }
      case "question.asked": {
        const sessionID = event.properties.sessionID
        const questions = store.question[sessionID]
        if (!questions) {
          setStore("question", sessionID, [event.properties])
          break
        }

        const result = Binary.search(questions, event.properties.id, (q) => q.id)
        if (result.found) {
          setStore("question", sessionID, result.index, reconcile(event.properties))
          break
        }

        setStore(
          "question",
          sessionID,
          produce((draft) => {
            draft.splice(result.index, 0, event.properties)
          }),
        )
        break
      }
      case "question.replied":
      case "question.rejected": {
        const questions = store.question[event.properties.sessionID]
        if (!questions) break
        const result = Binary.search(questions, event.properties.requestID, (q) => q.id)
        if (!result.found) break
        setStore(
          "question",
          event.properties.sessionID,
          produce((draft) => {
            draft.splice(result.index, 1)
          }),
        )
        break
      }
      case "lsp.updated": {
        const sdk = createOpencodeClient({
          baseUrl: globalSDK.url,
          fetch: platform.fetch,
          directory,
          throwOnError: true,
        })
        sdk.lsp.status().then((x) => setStore("lsp", x.data ?? []))
        break
      }
    }
  })
  onCleanup(unsub)

  async function bootstrap() {
    const health = await globalSDK.client.global
      .health()
      .then((x) => x.data)
      .catch(() => undefined)
    if (!health?.healthy) {
      setGlobalStore(
        "error",
        new Error(`Could not connect to server. Is there a server running at \`${globalSDK.url}\`?`),
      )
      return
    }

    return Promise.all([
      retry(() =>
        globalSDK.client.path.get().then((x) => {
          setGlobalStore("path", x.data!)
        }),
      ),
      retry(() =>
        globalSDK.client.project.list().then(async (x) => {
          const projects = (x.data ?? [])
            .filter((p) => !!p?.id)
            .filter((p) => !!p.worktree && !p.worktree.includes("opencode-test"))
            .slice()
            .sort((a, b) => a.id.localeCompare(b.id))
          setGlobalStore("project", projects)
        }),
      ),
      retry(() =>
        globalSDK.client.provider.list().then((x) => {
          const data = x.data!
          setGlobalStore("provider", {
            ...data,
            all: data.all.map((provider) => ({
              ...provider,
              models: Object.fromEntries(
                Object.entries(provider.models).filter(([, info]) => info.status !== "deprecated"),
              ),
            })),
          })
        }),
      ),
      retry(() =>
        globalSDK.client.provider.auth().then((x) => {
          setGlobalStore("provider_auth", x.data ?? {})
        }),
      ),
    ])
      .then(() => setGlobalStore("ready", true))
      .catch((e) => setGlobalStore("error", e))
  }

  onMount(() => {
    bootstrap()
  })

  return {
    data: globalStore,
    get ready() {
      return globalStore.ready
    },
    get error() {
      return globalStore.error
    },
    child,
    bootstrap,
    project: {
      loadSessions,
    },
  }
}

const GlobalSyncContext = createContext<ReturnType<typeof createGlobalSync>>()

export function GlobalSyncProvider(props: ParentProps) {
  const value = createGlobalSync()
  return (
    <Switch>
      <Match when={value.error}>
        <ErrorPage error={value.error} />
      </Match>
      <Match when={value.ready}>
        <GlobalSyncContext.Provider value={value}>{props.children}</GlobalSyncContext.Provider>
      </Match>
    </Switch>
  )
}

export function useGlobalSync() {
  const context = useContext(GlobalSyncContext)
  if (!context) throw new Error("useGlobalSync must be used within GlobalSyncProvider")
  return context
}

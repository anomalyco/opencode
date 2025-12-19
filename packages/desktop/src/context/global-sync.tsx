import {
  type Message,
  type Agent,
  type Session,
  type Part,
  type Config,
  type Path,
  type File,
  type FileNode,
  type Project,
  type FileDiff,
  type Todo,
  type SessionStatus,
  type ProviderListResponse,
  type ProviderAuthResponse,
  type Command,
  createOpencodeClient,
} from "@opencode-ai/sdk/v2/client"
import { createStore, produce, reconcile } from "solid-js/store"
import { Binary } from "@opencode-ai/util/binary"
import { useGlobalSDK } from "./global-sdk"
import { ErrorPage, type InitError } from "../pages/error"
import { createContext, useContext, onMount, type ParentProps, Switch, Match } from "solid-js"

type State = {
  ready: boolean
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
  limit: number
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
  node: FileNode[]
  changes: File[]
}

function createGlobalSync() {
  const globalSDK = useGlobalSDK()
  const [globalStore, setGlobalStore] = createStore<{
    ready: boolean
    error?: InitError
    path: Path
    project: Project[]
    provider: ProviderListResponse
    provider_auth: ProviderAuthResponse
    children: Record<string, State>
  }>({
    ready: false,
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    project: [],
    provider: { all: [], connected: [], default: {} },
    provider_auth: {},
    children: {},
  })

  const children: Record<string, ReturnType<typeof createStore<State>>> = {}
  function child(directory: string) {
    if (!directory) console.error("No directory provided")
    if (!children[directory]) {
      setGlobalStore("children", directory, {
        project: "",
        provider: { all: [], connected: [], default: {} },
        config: {},
        path: { state: "", config: "", worktree: "", directory: "", home: "" },
        ready: false,
        agent: [],
        command: [],
        session: [],
        session_status: {},
        session_diff: {},
        todo: {},
        limit: 5,
        message: {},
        part: {},
        node: [],
        changes: [],
      })
      children[directory] = createStore(globalStore.children[directory])
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
          .slice()
          .filter((s) => !s.time.archived)
          .sort((a, b) => a.id.localeCompare(b.id))
        // Include up to the limit, plus any updated in the last 4 hours
        const sessions = nonArchived.filter((s, i) => {
          if (i < store.limit) return true
          const updated = new Date(s.time.updated).getTime()
          return updated > fourHoursAgo
        })
        setStore("session", sessions)
      })
      .catch((err) => {
        console.error("Failed to load sessions", err)
        setGlobalStore("error", err)
      })
  }

  async function bootstrapInstance(directory: string) {
    if (!directory) return
    const [, setStore] = child(directory)
    const sdk = createOpencodeClient({
      baseUrl: globalSDK.url,
      directory,
      throwOnError: true,
    })
    const load = {
      project: () => sdk.project.current().then((x) => setStore("project", x.data!.id)),
      provider: () => sdk.provider.list().then((x) => setStore("provider", x.data!)),
      path: () => sdk.path.get().then((x) => setStore("path", x.data!)),
      agent: () => sdk.app.agents().then((x) => setStore("agent", x.data ?? [])),
      command: () => sdk.command.list().then((x) => setStore("command", x.data ?? [])),
      session: () => loadSessions(directory),
      status: () => sdk.session.status().then((x) => setStore("session_status", x.data!)),
      config: () => sdk.config.get().then((x) => setStore("config", x.data!)),
      changes: () => sdk.file.status().then((x) => setStore("changes", x.data!)),
      node: () => sdk.file.list({ path: "/" }).then((x) => setStore("node", x.data!)),
    }
    await Promise.all(Object.values(load).map((p) => p().catch((e) => setGlobalStore("error", e))))
      .then(() => setStore("ready", true))
      .catch((e) => setGlobalStore("error", e))
  }

  globalSDK.event.listen((e) => {
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
        setStore("session_diff", event.properties.sessionID, event.properties.diff)
        break
      case "todo.updated":
        setStore("todo", event.properties.sessionID, event.properties.todos)
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
    }
  })

  async function bootstrap() {
    return Promise.all([
      globalSDK.client.path.get().then((x) => {
        setGlobalStore("path", x.data!)
      }),
      globalSDK.client.project.list().then(async (x) => {
        setGlobalStore(
          "project",
          x.data!.filter((p) => !p.worktree.includes("opencode-test")).sort((a, b) => a.id.localeCompare(b.id)),
        )
      }),
      globalSDK.client.provider.list().then((x) => {
        setGlobalStore("provider", x.data ?? {})
      }),
      globalSDK.client.provider.auth().then((x) => {
        setGlobalStore("provider_auth", x.data ?? {})
      }),
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

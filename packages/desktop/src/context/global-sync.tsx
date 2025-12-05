import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Path,
  File,
  FileNode,
  Project,
  FileDiff,
  Todo,
  SessionStatus,
} from "@opencode-ai/sdk"
import { createStore, produce, reconcile } from "solid-js/store"
import { Binary } from "@opencode-ai/util/binary"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSDK } from "./global-sdk"

type State = {
  ready: boolean
  provider: Provider[]
  agent: Agent[]
  project: Project
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

export const { use: useGlobalSync, provider: GlobalSyncProvider } = createSimpleContext({
  name: "GlobalSync",
  init: () => {
    const [globalStore, setGlobalStore] = createStore<{
      ready: boolean
      defaultProject?: Project // TODO: remove this when we can select projects
      projects: Project[]
      children: Record<string, State>
    }>({
      ready: false,
      projects: [],
      children: {},
    })

    const children: Record<string, ReturnType<typeof createStore<State>>> = {}

    function child(directory: string) {
      if (!children[directory]) {
        setGlobalStore("children", directory, {
          project: { id: "", worktree: "", time: { created: 0, initialized: 0 } },
          config: {},
          path: { state: "", config: "", worktree: "", directory: "" },
          ready: false,
          agent: [],
          provider: [],
          session: [],
          session_status: {},
          session_diff: {},
          todo: {},
          limit: 10,
          message: {},
          part: {},
          node: [],
          changes: [],
        })
        children[directory] = createStore(globalStore.children[directory])
      }
      return children[directory]
    }

    const sdk = useGlobalSDK()
    sdk.event.listen((e) => {
      const directory = e.name
      const [store, setStore] = child(directory)

      const event = e.details
      switch (event.type) {
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
      }
    })

    Promise.all([
      sdk.client.project.list().then((x) =>
        setGlobalStore(
          "projects",
          x.data!.filter((x) => !x.worktree.includes("opencode-test")),
        ),
      ),
      // TODO: remove this when we can select projects
      sdk.client.project.current().then((x) => setGlobalStore("defaultProject", x.data)),
    ]).then(() => setGlobalStore("ready", true))

    return {
      data: globalStore,
      get ready() {
        return globalStore.ready
      },
      child,
    }
  },
})

import type {
  Message,
  Agent,
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
  ProviderListResponse,
  ProviderAuthResponse,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { Binary } from "@opencode-ai/util/binary"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSDK } from "./global-sdk"
import { onMount } from "solid-js"

type State = {
  ready: boolean
  agent: Agent[]
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

export const { use: useGlobalSync, provider: GlobalSyncProvider } = createSimpleContext({
  name: "GlobalSync",
  init: () => {
    const sdk = useGlobalSDK()
    const [globalStore, setGlobalStore] = createStore<{
      ready: boolean
      project: Project[]
      provider: ProviderListResponse
      provider_auth: ProviderAuthResponse
      children: Record<string, State>
    }>({
      ready: false,
      project: [],
      provider: { all: [], connected: [], default: {} },
      provider_auth: {},
      children: {},
    })

    const children: Record<string, ReturnType<typeof createStore<State>>> = {}
    function child(directory: string) {
      if (!children[directory]) {
        setGlobalStore("children", directory, {
          project: "",
          provider: { all: [], connected: [], default: {} },
          config: {},
          path: { state: "", config: "", worktree: "", directory: "", home: "" },
          ready: false,
          agent: [],
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
      }
      return children[directory]
    }

    sdk.event.listen((e) => {
      const directory = e.name
      const event = e.details

      if (directory === "global") {
        switch (event.type) {
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
        // case "server.instance.disposed": {
        //   bootstrap()
        //   break
        // }
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

    async function bootstrap() {
      return Promise.all([
        sdk.client.project.list().then(async (x) => {
          setGlobalStore(
            "project",
            x
              .data!.filter((p) => !p.worktree.includes("opencode-test") && p.vcs)
              .sort((a, b) => a.id.localeCompare(b.id)),
          )
        }),
        sdk.client.provider.list().then((x) => {
          setGlobalStore("provider", x.data ?? {})
        }),
        sdk.client.provider.auth().then((x) => {
          setGlobalStore("provider_auth", x.data ?? {})
        }),
      ]).then(() => setGlobalStore("ready", true))
    }

    onMount(() => {
      bootstrap()
    })

    return {
      data: globalStore,
      get ready() {
        return globalStore.ready
      },
      child,
      bootstrap,
    }
  },
})

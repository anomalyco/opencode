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
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { Binary } from "@opencode-ai/util/binary"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSDK } from "./global-sdk"

const PASTEL_COLORS = [
  "#FCEAFD", // pastel pink
  "#FFDFBA", // pastel peach
  "#FFFFBA", // pastel yellow
  "#BAFFC9", // pastel green
  "#EAF6FD", // pastel blue
  "#EFEAFD", // pastel lavender
  "#FEC8D8", // pastel rose
  "#D4F0F0", // pastel cyan
  "#FDF0EA", // pastel coral
  "#C1E1C1", // pastel mint
]

function randomPastelColor() {
  return PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)]
}

async function ensureProjectColor(project: Project, sdk: ReturnType<typeof useGlobalSDK>): Promise<Project> {
  if (project.icon?.color) return project
  const color = randomPastelColor()
  const updated = { ...project, icon: { ...project.icon, color } }
  sdk.client.project.update({ projectID: project.id, icon: { color } })
  return updated
}

type State = {
  ready: boolean
  provider: Provider[]
  agent: Agent[]
  project: string
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
          project: "",
          config: {},
          path: { state: "", config: "", worktree: "", directory: "" },
          ready: false,
          agent: [],
          provider: [],
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

    const sdk = useGlobalSDK()
    sdk.event.listen((e) => {
      const directory = e.name
      const event = e.details

      if (directory === "global") {
        switch (event.type) {
          case "project.updated": {
            ensureProjectColor(event.properties, sdk).then((project) => {
              const result = Binary.search(globalStore.projects, project.id, (s) => s.id)
              if (result.found) {
                setGlobalStore("projects", result.index, reconcile(project))
                return
              }
              setGlobalStore(
                "projects",
                produce((draft) => {
                  draft.splice(result.index, 0, project)
                }),
              )
            })
            break
          }
        }
        return
      }

      const [store, setStore] = child(directory)
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
      sdk.client.project.list().then(async (x) => {
        const filtered = x.data!.filter((p) => !p.worktree.includes("opencode-test") && p.vcs)
        const projects = await Promise.all(filtered.map((p) => ensureProjectColor(p, sdk)))
        setGlobalStore(
          "projects",
          projects.sort((a, b) => a.id.localeCompare(b.id)),
        )
      }),
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

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
} from "@opencode-ai/sdk"
import { createStore, produce, reconcile } from "solid-js/store"
import { createMemo } from "solid-js"
import { Binary } from "@/utils/binary"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      ready: boolean
      provider: Provider[]
      agent: Agent[]
      project: Project
      config: Config
      path: Path
      session: Session[]
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
    }>({
      project: { id: "", worktree: "", time: { created: 0, initialized: 0 } },
      config: {},
      path: { state: "", config: "", worktree: "", directory: "" },
      ready: false,
      agent: [],
      provider: [],
      session: [],
      session_diff: {},
      todo: {},
      limit: 10,
      message: {},
      part: {},
      node: [],
      changes: [],
    })

    const sdk = useSDK()
    sdk.event.listen((e) => {
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
          const part = sanitizePart(event.properties.part)
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

    const load = {
      project: () => sdk.client.project.current().then((x) => setStore("project", x.data!)),
      provider: () => sdk.client.config.providers().then((x) => setStore("provider", x.data!.providers)),
      path: () => sdk.client.path.get().then((x) => setStore("path", x.data!)),
      agent: () => sdk.client.app.agents().then((x) => setStore("agent", x.data ?? [])),
      session: () =>
        sdk.client.session.list().then((x) => {
          const sessions = (x.data ?? [])
            .slice()
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, store.limit)
          setStore("session", sessions)
        }),
      config: () => sdk.client.config.get().then((x) => setStore("config", x.data!)),
      changes: () => sdk.client.file.status().then((x) => setStore("changes", x.data!)),
      node: () => sdk.client.file.list({ query: { path: "/" } }).then((x) => setStore("node", x.data!)),
    }

    Promise.all(Object.values(load).map((p) => p())).then(() => setStore("ready", true))

    const sanitizer = createMemo(() => new RegExp(`${store.path.directory}/`, "g"))
    const sanitize = (text: string) => text.replace(sanitizer(), "")
    const absolute = (path: string) => (store.path.directory + "/" + path).replace("//", "/")
    const sanitizePart = (part: Part) => {
      if (part.type === "tool") {
        if (part.state.status === "completed" || part.state.status === "error") {
          for (const key in part.state.metadata) {
            if (typeof part.state.metadata[key] === "string") {
              part.state.metadata[key] = sanitize(part.state.metadata[key] as string)
            }
          }
          for (const key in part.state.input) {
            if (typeof part.state.input[key] === "string") {
              part.state.input[key] = sanitize(part.state.input[key] as string)
            }
          }
          if ("error" in part.state) {
            part.state.error = sanitize(part.state.error as string)
          }
        }
      }
      return part
    }

    return {
      data: store,
      set: setStore,
      get ready() {
        return store.ready
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        async sync(sessionID: string, _isRetry = false) {
          const [session, messages, todo, diff] = await Promise.all([
            sdk.client.session.get({ path: { id: sessionID }, throwOnError: true }),
            sdk.client.session.messages({ path: { id: sessionID }, query: { limit: 100 } }),
            sdk.client.session.todo({ path: { id: sessionID } }),
            sdk.client.session.diff({ path: { id: sessionID } }),
          ])
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session[match.index] = session.data!
              if (!match.found) draft.session.splice(match.index, 0, session.data!)
              draft.todo[sessionID] = todo.data ?? []
              draft.message[sessionID] = messages
                .data!.map((x) => x.info)
                .slice()
                .sort((a, b) => a.id.localeCompare(b.id))
              for (const message of messages.data!) {
                draft.part[message.info.id] = message.parts
                  .slice()
                  .map(sanitizePart)
                  .sort((a, b) => a.id.localeCompare(b.id))
              }
              draft.session_diff[sessionID] = diff.data ?? []
            }),
          )
        },
        fetch: async (count = 10) => {
          setStore("limit", (x) => x + count)
          await load.session()
        },
        more: createMemo(() => store.session.length >= store.limit),
      },
      load,
      absolute,
      sanitize,
    }
  },
})

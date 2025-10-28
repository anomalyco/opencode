import type { Message, Agent, Provider, Session, Part, Config, Path, File, FileNode, Project } from "@opencode-ai/sdk"
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
      }
    })

    const load = {
      project: () => sdk.client.project.current().then((x) => setStore("project", x.data!)),
      provider: () => sdk.client.config.providers().then((x) => setStore("provider", x.data!.providers)),
      path: () => sdk.client.path.get().then((x) => setStore("path", x.data!)),
      agent: () => sdk.client.app.agents().then((x) => setStore("agent", x.data ?? [])),
      session: () =>
        sdk.client.session.list().then((x) =>
          setStore(
            "session",
            (x.data ?? []).slice().sort((a, b) => a.id.localeCompare(b.id)),
          ),
        ),
      config: () => sdk.client.config.get().then((x) => setStore("config", x.data!)),
      changes: () => sdk.client.file.status().then((x) => setStore("changes", x.data!)),
      node: () => sdk.client.file.list({ query: { path: "/" } }).then((x) => setStore("node", x.data!)),
    }

    Promise.all(Object.values(load).map((p) => p())).then(() => setStore("ready", true))

    const sanitizer = createMemo(() => new RegExp(`${store.path.directory}/`, "g"))
    const sanitize = (text: string) => text.replace(sanitizer(), "")
    const absolute = (path: string) => (store.path.directory + "/" + path).replace("//", "/")

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
        async sync(sessionID: string, isRetry = false) {
          const [session, messages] = await Promise.all([
            sdk.client.session.get({ path: { id: sessionID } }),
            sdk.client.session.messages({ path: { id: sessionID } }),
          ])

          // If no messages and this might be a new session, retry after a delay
          if (!isRetry && messages.data!.length === 0) {
            setTimeout(() => this.sync(sessionID, true), 500)
            return
          }

          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              draft.session[match.index] = session.data!
              draft.message[sessionID] = messages
                .data!.map((x) => x.info)
                .slice()
                .sort((a, b) => a.id.localeCompare(b.id))
              for (const message of messages.data!) {
                draft.part[message.info.id] = message.parts.slice().sort((a, b) => a.id.localeCompare(b.id))
              }
            }),
          )
        },
      },
      load,
      absolute,
      sanitize,
    }
  },
})

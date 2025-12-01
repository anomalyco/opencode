import { produce } from "solid-js/store"
import { createMemo } from "solid-js"
import { Binary } from "@opencode-ai/util/binary"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSync } from "./global-sync"
import { useSDK } from "./sdk"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const globalSync = useGlobalSync()
    const sdk = useSDK()
    const [store, setStore] = globalSync.child(sdk.directory)

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
      status: () => sdk.client.session.status().then((x) => setStore("session_status", x.data!)),
      config: () => sdk.client.config.get().then((x) => setStore("config", x.data!)),
      changes: () => sdk.client.file.status().then((x) => setStore("changes", x.data!)),
      node: () => sdk.client.file.list({ query: { path: "/" } }).then((x) => setStore("node", x.data!)),
    }

    Promise.all(Object.values(load).map((p) => p())).then(() => setStore("ready", true))

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
                draft.part[message.info.id] = message.parts.slice().sort((a, b) => a.id.localeCompare(b.id))
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
      get directory() {
        return store.path.directory
      },
    }
  },
})

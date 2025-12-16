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
    const absolute = (path: string) => (store.path.directory + "/" + path).replace("//", "/")

    return {
      data: store,
      set: setStore,
      get ready() {
        return store.ready
      },
      get project() {
        const match = Binary.search(globalSync.data.project, store.project, (p) => p.id)
        if (match.found) return globalSync.data.project[match.index]
        return undefined
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        async sync(sessionID: string, _isRetry = false) {
          const [session, messages, todo, diff] = await Promise.all([
            sdk.client.session.get({ sessionID }, { throwOnError: true }),
            sdk.client.session.messages({ sessionID, limit: 100 }),
            sdk.client.session.todo({ sessionID }),
            sdk.client.session.diff({ sessionID }),
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
          await sdk.client.session.list().then((x) => {
            const sessions = (x.data ?? [])
              .slice()
              .sort((a, b) => a.id.localeCompare(b.id))
              .slice(0, store.limit)
            setStore("session", sessions)
          })
        },
        more: createMemo(() => store.session.length >= store.limit),
        archive: async (sessionID: string) => {
          await sdk.client.session.update({ sessionID, time: { archived: Date.now() } })
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session.splice(match.index, 1)
            }),
          )
        },
      },
      absolute,
      get directory() {
        return store.path.directory
      },
    }
  },
})

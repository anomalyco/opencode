import { produce } from "solid-js/store"
import { createMemo } from "solid-js"
import { Binary } from "@opencode-ai/util/binary"
import { retry } from "@opencode-ai/util/retry"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSync } from "./global-sync"
import { useSDK } from "./sdk"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"

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
        addOptimisticMessage(input: {
          sessionID: string
          messageID: string
          parts: Part[]
          agent: string
          model: { providerID: string; modelID: string }
        }) {
          const message: Message = {
            id: input.messageID,
            sessionID: input.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: input.agent,
            model: input.model,
          }
          setStore(
            produce((draft) => {
              const messages = draft.message[input.sessionID]
              if (!messages) {
                draft.message[input.sessionID] = [message]
              } else {
                const result = Binary.search(messages, input.messageID, (m) => m.id)
                messages.splice(result.index, 0, message)
              }
              draft.part[input.messageID] = input.parts.slice()
            }),
          )
        },
        async sync(sessionID: string, _isRetry = false) {
          const [session, messages, todo, diff] = await Promise.all([
            retry(() => sdk.client.session.get({ sessionID })),
            retry(() => sdk.client.session.messages({ sessionID, limit: 100 })),
            retry(() => sdk.client.session.todo({ sessionID })),
            retry(() => sdk.client.session.diff({ sessionID })),
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

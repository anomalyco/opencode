import { createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import type { AgentPartInput, FilePartInput, SubtaskPartInput, TextPartInput } from "@opencode-ai/sdk/v2/client"
import { useLanguage } from "@/context/language"
import { useSDK } from "./sdk"
import { useSync } from "./sync"

type PromptPartInput = (TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput) & { id?: string }

export type FollowupQueueItem = {
  sessionID: string
  messageID: string
  parts: PromptPartInput[]
  agent: string
  model: {
    providerID: string
    modelID: string
  }
  variant?: string
}

export const { use: useFollowupQueue, provider: FollowupQueueProvider } = createSimpleContext({
  name: "FollowupQueue",
  init: () => {
    const sdk = useSDK()
    const sync = useSync()
    const language = useLanguage()
    const [store, setStore] = createStore<{
      items: Record<string, FollowupQueueItem[] | undefined>
    }>({
      items: {},
    })

    const dispatching = new Set<string>()

    const errorMessage = (err: unknown) => {
      if (err && typeof err === "object" && "data" in err) {
        const data = (err as { data?: { message?: string } }).data
        if (data?.message) return data.message
      }
      if (err instanceof Error) return err.message
      return language.t("common.requestFailed")
    }

    const queueFor = (sessionID: string) => store.items[sessionID] ?? []

    const removeQueuedItem = (sessionID: string, messageID: string) => {
      setStore("items", sessionID, (items) => {
        if (!items?.length) return undefined
        const next = items.filter((item) => item.messageID !== messageID)
        return next.length > 0 ? next : undefined
      })
    }

    const dispatchNext = (sessionID: string) => {
      if (dispatching.has(sessionID)) return

      const status = sync.data.session_status[sessionID] ?? { type: "idle" as const }
      if (status.type !== "idle") return

      const next = queueFor(sessionID)[0]
      if (!next) return

      dispatching.add(sessionID)
      sync.set("session_status", sessionID, { type: "busy" })

      void sdk.client.session
        .promptAsync({
          sessionID: next.sessionID,
          messageID: next.messageID,
          agent: next.agent,
          model: next.model,
          parts: next.parts,
          variant: next.variant,
        })
        .then(() => {
          removeQueuedItem(sessionID, next.messageID)
        })
        .catch((err) => {
          removeQueuedItem(sessionID, next.messageID)
          sync.session.optimistic.remove({
            sessionID: next.sessionID,
            messageID: next.messageID,
          })
          sync.set("session_status", sessionID, { type: "idle" })
          showToast({
            title: language.t("prompt.toast.promptSendFailed.title"),
            description: errorMessage(err),
          })
        })
        .finally(() => {
          dispatching.delete(sessionID)
        })
    }

    createEffect(() => {
      for (const sessionID of Object.keys(store.items)) {
        dispatchNext(sessionID)
      }
    })

    return {
      enqueue(item: FollowupQueueItem) {
        setStore("items", item.sessionID, (items) => [...(items ?? []), item])
      },
      count(sessionID: string) {
        return queueFor(sessionID).length
      },
      isQueued(sessionID: string, messageID: string) {
        return queueFor(sessionID).some((item) => item.messageID === messageID)
      },
    }
  },
})

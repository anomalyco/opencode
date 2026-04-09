import { batch, createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import type {
  AgentPartInput,
  FilePartInput,
  Message,
  Part,
  SubtaskPartInput,
  TextPartInput,
} from "@opencode-ai/sdk/v2/client"
import { useLanguage } from "@/context/language"
import { Identifier } from "@/utils/id"
import { useSDK } from "./sdk"
import { useSync } from "./sync"

type PromptPartInput = (TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput) & { id?: string }

export type FollowupQueueItem = {
  sessionID: string
  optimisticMessage: Message
  optimisticParts: Part[]
  requestParts: PromptPartInput[]
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
      active: Record<
        string,
        | {
            messageID: string
          }
        | undefined
      >
    }>({
      items: {},
      active: {},
    })

    const starting = new Set<string>()

    const errorMessage = (err: unknown) => {
      if (err && typeof err === "object" && "data" in err) {
        const data = (err as { data?: { message?: string } }).data
        if (data?.message) return data.message
      }
      if (err instanceof Error) return err.message
      return language.t("common.requestFailed")
    }

    const queueFor = (sessionID: string) => store.items[sessionID] ?? []
    const activeFor = (sessionID: string) => store.active[sessionID]

    const dropQueuedHead = (sessionID: string) => {
      setStore("items", sessionID, (items) => {
        if (!items?.length) return undefined
        const next = items.slice(1)
        return next.length > 0 ? next : undefined
      })
    }

    const setActive = (sessionID: string, messageID: string) => {
      setStore("active", sessionID, { messageID })
    }

    const clearActive = (sessionID: string) => {
      setStore("active", sessionID, undefined)
    }

    const rekeyOptimisticFollowup = (input: FollowupQueueItem) => {
      const messageID = Identifier.ascending("message")
      return {
        messageID,
        message: {
          ...input.optimisticMessage,
          id: messageID,
          time: {
            ...input.optimisticMessage.time,
            created: Date.now(),
          },
        } satisfies Message,
        parts: input.optimisticParts.map((part) => ({
          ...part,
          sessionID: input.sessionID,
          messageID,
        })) satisfies Part[],
      }
    }

    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const waitForQueuedTurn = async (sessionID: string, messageID: string) => {
      const timeoutAt = Date.now() + 5 * 60 * 1000
      let sawAssistant = false

      while (Date.now() < timeoutAt) {
        const [statusResult, messagesResult] = await Promise.all([
          sdk.client.session.status(),
          sdk.client.session.messages({ sessionID, limit: 200 }),
        ])

        const status = statusResult.data?.[sessionID] ?? { type: "idle" as const }
        const messages = messagesResult.data ?? []

        if (!sawAssistant) {
          sawAssistant = messages.some(
            (message) => message.info.role === "assistant" && message.info.parentID === messageID,
          )
        }

        if (sawAssistant && status.type === "idle") {
          return true
        }

        await wait(500)
      }

      return false
    }

    const dispatchNext = async (sessionID: string) => {
      if (activeFor(sessionID) || starting.has(sessionID)) return

      const next = queueFor(sessionID)[0]
      if (!next) return

      starting.add(sessionID)

      try {
        const status = await sdk.client.session
          .status()
          .then((result) => result.data?.[sessionID] ?? { type: "idle" as const })
        if (status.type !== "idle") return

        const optimistic = rekeyOptimisticFollowup(next)

        batch(() => {
          setActive(sessionID, optimistic.messageID)
          dropQueuedHead(sessionID)
          sync.session.optimistic.remove({
            sessionID: next.sessionID,
            messageID: next.optimisticMessage.id,
          })
          sync.session.optimistic.add({
            sessionID: next.sessionID,
            message: optimistic.message,
            parts: optimistic.parts,
          })
        })

        starting.delete(sessionID)

        await sdk.client.session.promptAsync({
          sessionID: next.sessionID,
          messageID: optimistic.messageID,
          agent: next.agent,
          model: next.model,
          parts: next.requestParts,
          variant: next.variant,
        })

        const completed = await waitForQueuedTurn(sessionID, optimistic.messageID)
        if (!completed) {
          batch(() => {
            showToast({
              title: language.t("prompt.toast.promptSendFailed.title"),
              description: "Timed out waiting for queued follow-up to finish",
            })
          })
        }
      } catch (err) {
        const active = activeFor(sessionID)
        batch(() => {
          if (active?.messageID) {
            sync.session.optimistic.remove({
              sessionID: next.sessionID,
              messageID: active.messageID,
            })
          }
          showToast({
            title: language.t("prompt.toast.promptSendFailed.title"),
            description: errorMessage(err),
          })
        })
      } finally {
        starting.delete(sessionID)
        clearActive(sessionID)
      }
    }

    createEffect(() => {
      const sessionIDs = new Set([...Object.keys(store.items), ...Object.keys(store.active)])

      for (const sessionID of sessionIDs) {
        const active = activeFor(sessionID)
        const status = sync.data.session_status[sessionID] ?? { type: "idle" as const }

        if (active || status.type !== "idle") continue
        void dispatchNext(sessionID)
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
        return queueFor(sessionID).some((item) => item.optimisticMessage.id === messageID)
      },
    }
  },
})

import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { batch, createEffect, createMemo } from "solid-js"
import { useSync } from "./sync"
import { makePersisted } from "@solid-primitives/storage"
import { TextSelection, useLocal } from "./local"
import { pipe, sumBy } from "remeda"
import { AssistantMessage } from "@opencode-ai/sdk"

export const { use: useSession, provider: SessionProvider } = createSimpleContext({
  name: "Session",
  init: (props: { sessionId?: string }) => {
    const sync = useSync()
    const local = useLocal()

    const [store, setStore] = makePersisted(
      createStore<{
        prompt: Prompt
        cursorPosition?: number
        messageId?: string
        tabs: {
          active?: string
          opened: string[]
        }
      }>({
        prompt: [{ type: "text", content: "", start: 0, end: 0 }],
        tabs: {
          opened: [],
        },
      }),
      {
        name: props.sessionId ?? "new-session",
      },
    )

    createEffect(() => {
      if (!props.sessionId) return
      sync.session.sync(props.sessionId)
    })

    const info = createMemo(() => (props.sessionId ? sync.session.get(props.sessionId) : undefined))
    const messages = createMemo(() => (props.sessionId ? (sync.data.message[props.sessionId] ?? []) : []))
    const userMessages = createMemo(() =>
      messages()
        .filter((m) => m.role === "user")
        .sort((a, b) => b.id.localeCompare(a.id)),
    )
    const lastUserMessage = createMemo(() => {
      return userMessages()?.at(0)
    })
    const activeMessage = createMemo(() => {
      if (!store.messageId) return lastUserMessage()
      return userMessages()?.find((m) => m.id === store.messageId)
    })
    const working = createMemo(() => {
      if (!props.sessionId) return false
      const last = lastUserMessage()
      if (!last) return false
      const assistantMessages = sync.data.message[props.sessionId]?.filter(
        (m) => m.role === "assistant" && m.parentID == last?.id,
      ) as AssistantMessage[]
      const error = assistantMessages?.find((m) => m?.error)?.error
      return !last?.summary?.body && !error
    })

    const cost = createMemo(() => {
      const total = pipe(
        messages(),
        sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
      )
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(total)
    })

    const last = createMemo(
      () => messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage,
    )
    const model = createMemo(() =>
      last() ? sync.data.provider.find((x) => x.id === last().providerID)?.models[last().modelID] : undefined,
    )
    const diffs = createMemo(() => (props.sessionId ? (sync.data.session_diff[props.sessionId] ?? []) : []))

    const tokens = createMemo(() => {
      if (!last()) return
      const tokens = last().tokens
      return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
    })

    const context = createMemo(() => {
      const total = tokens()
      const limit = model()?.limit.context
      if (!total || !limit) return 0
      return Math.round((total / limit) * 100)
    })

    return {
      id: props.sessionId,
      info,
      working,
      diffs,
      prompt: {
        current: createMemo(() => store.prompt),
        cursor: createMemo(() => store.cursorPosition),
        dirty: createMemo(() => !isPromptEqual(store.prompt, DEFAULT_PROMPT)),
        set(prompt: Prompt, cursorPosition?: number) {
          batch(() => {
            setStore("prompt", prompt)
            if (cursorPosition !== undefined) setStore("cursorPosition", cursorPosition)
          })
        },
      },
      messages: {
        all: messages,
        user: userMessages,
        last: lastUserMessage,
        active: activeMessage,
        setActive(id: string | undefined) {
          setStore("messageId", id)
        },
      },
      usage: {
        tokens,
        cost,
        context,
      },
      layout: {
        tabs: store.tabs,
        setActiveTab(tab: string | undefined) {
          setStore("tabs", "active", tab)
        },
        setOpenedTabs(tabs: string[]) {
          setStore("tabs", "opened", tabs)
        },
        async openTab(tab: string) {
          if (tab === "chat") {
            setStore("tabs", "active", undefined)
            return
          }
          if (tab.startsWith("file://")) {
            await local.file.open(tab.replace("file://", ""))
          }
          if (tab !== "review") {
            if (!store.tabs.opened.includes(tab)) {
              setStore("tabs", "opened", [...store.tabs.opened, tab])
            }
          }
          setStore("tabs", "active", tab)
        },
        closeTab(tab: string) {
          batch(() => {
            setStore(
              "tabs",
              "opened",
              store.tabs.opened.filter((x) => x !== tab),
            )
            if (store.tabs.active === tab) {
              const index = store.tabs.opened.findIndex((f) => f === tab)
              const previous = store.tabs.opened[Math.max(0, index - 1)]
              setStore("tabs", "active", previous)
            }
          })
        },
        moveTab(tab: string, to: number) {
          const index = store.tabs.opened.findIndex((f) => f === tab)
          if (index === -1) return
          setStore(
            "tabs",
            "opened",
            produce((opened) => {
              opened.splice(to, 0, opened.splice(index, 1)[0])
            }),
          )
          // setStore("node", path, "pinned", true)
        },
      },
    }
  },
})

interface PartBase {
  content: string
  start: number
  end: number
}

export interface TextPart extends PartBase {
  type: "text"
}

export interface FileAttachmentPart extends PartBase {
  type: "file"
  path: string
  selection?: TextSelection
}

export type ContentPart = TextPart | FileAttachmentPart
export type Prompt = ContentPart[]

export const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

export function isPromptEqual(promptA: Prompt, promptB: Prompt): boolean {
  if (promptA.length !== promptB.length) return false
  for (let i = 0; i < promptA.length; i++) {
    const partA = promptA[i]
    const partB = promptB[i]
    if (partA.type !== partB.type) return false
    if (partA.type === "text" && partA.content !== (partB as TextPart).content) {
      return false
    }
    if (partA.type === "file" && partA.path !== (partB as FileAttachmentPart).path) {
      return false
    }
  }
  return true
}

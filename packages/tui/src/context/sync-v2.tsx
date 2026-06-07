import { useEvent } from "./event"
import type {
  Event,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

function activeAssistant(messages: SessionMessage[]) {
  const index = messages.findIndex((message) => message.type === "assistant" && !message.time.completed)
  if (index < 0) return
  const assistant = messages[index]
  return assistant?.type === "assistant" ? assistant : undefined
}

function ownedAssistant(messages: SessionMessage[], messageID: string) {
  const message = messages.find((message) => message.type === "assistant" && message.id === messageID)
  return message?.type === "assistant" ? message : undefined
}

function activeShell(messages: SessionMessage[], callID: string) {
  const index = messages.findIndex((message) => message.type === "shell" && message.callID === callID)
  if (index < 0) return
  const shell = messages[index]
  return shell?.type === "shell" ? shell : undefined
}

function latestTool(assistant: SessionMessageAssistant | undefined, callID?: string) {
  return assistant?.content.findLast(
    (item): item is SessionMessageAssistantTool => item.type === "tool" && (callID === undefined || item.id === callID),
  )
}

function latestText(assistant: SessionMessageAssistant | undefined, textID: string) {
  return assistant?.content.findLast(
    (item): item is SessionMessageAssistantText => item.type === "text" && item.id === textID,
  )
}

function latestReasoning(assistant: SessionMessageAssistant | undefined, reasoningID: string) {
  return assistant?.content.findLast(
    (item): item is SessionMessageAssistantReasoning => item.type === "reasoning" && item.id === reasoningID,
  )
}

function prepend(messages: SessionMessage[], message: SessionMessage) {
  if (messages.some((item) => item.id === message.id)) return
  messages.unshift(message)
}

export const { use: useSyncV2, provider: SyncProviderV2 } = createSimpleContext({
  name: "SyncV2",
  init: () => {
    const [store, setStore] = createStore<{
      messages: {
        [sessionID: string]: SessionMessage[]
      }
    }>({
      messages: {},
    })

    const event = useEvent()
    const sdk = useSDK()
    const applied = new Set<string>()
    const buffering = new Map<string, Event[]>()
    const syncing = new Map<string, Promise<void>>()

    function duplicate(id: string) {
      if (applied.has(id)) return true
      applied.add(id)
      if (applied.size <= 1000) return false
      const oldest = applied.values().next()
      if (!oldest.done) applied.delete(oldest.value)
      return false
    }

    function update(sessionID: string, fn: (messages: SessionMessage[]) => void) {
      setStore(
        "messages",
        produce((draft) => {
          fn((draft[sessionID] ??= []))
        }),
      )
    }

    async function hydrate(sessionID: string) {
      const pending: Event[] = []
      const before = JSON.parse(JSON.stringify(store.messages[sessionID] ?? [])) as SessionMessage[]
      buffering.set(sessionID, pending)
      try {
        const response = await sdk.client.v2.session.messages({ sessionID })
        const messages = response.data?.data ?? []
        const snapshotIDs = new Set(messages.map((message) => message.id))
        setStore(
          "messages",
          sessionID,
          reconcile([...messages, ...before.filter((message) => !snapshotIDs.has(message.id))]),
        )
        buffering.delete(sessionID)
        for (const event of pending) apply(event)
      } catch (error) {
        buffering.delete(sessionID)
        throw error
      }
    }

    function sync(sessionID: string) {
      const existing = syncing.get(sessionID)
      if (existing) return existing
      const result = hydrate(sessionID).finally(() => syncing.delete(sessionID))
      syncing.set(sessionID, result)
      return result
    }

    function apply(event: Event) {
      switch (event.type) {
        case "session.next.agent.switched":
          update(event.properties.sessionID, (draft) => {
            prepend(draft, {
              id: event.properties.messageID,
              type: "agent-switched",
              agent: event.properties.agent,
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "session.next.model.switched":
          update(event.properties.sessionID, (draft) => {
            prepend(draft, {
              id: event.properties.messageID,
              type: "model-switched",
              model: event.properties.model,
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "session.next.prompted": {
          update(event.properties.sessionID, (draft) => {
            prepend(draft, {
              id: event.properties.messageID,
              type: "user",
              text: event.properties.prompt.text,
              files: event.properties.prompt.files,
              agents: event.properties.prompt.agents,
              references: event.properties.prompt.references,
              time: { created: event.properties.timestamp },
            })
          })
          break
        }
        case "session.next.prompt.admitted":
          break
        case "session.next.prompt.promoted":
          update(event.properties.sessionID, (draft) => {
            prepend(draft, {
              id: event.properties.messageID,
              type: "user",
              text: event.properties.prompt.text,
              files: event.properties.prompt.files,
              agents: event.properties.prompt.agents,
              references: event.properties.prompt.references,
              time: { created: event.properties.timeCreated },
            })
          })
          break
        case "session.next.context.updated":
          update(event.properties.sessionID, (draft) => {
            prepend(draft, {
              id: event.properties.messageID,
              type: "system",
              text: event.properties.text,
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "session.next.synthetic":
          update(event.properties.sessionID, (draft) => {
            prepend(draft, {
              id: event.properties.messageID,
              type: "synthetic",
              sessionID: event.properties.sessionID,
              text: event.properties.text,
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "session.next.shell.started":
          update(event.properties.sessionID, (draft) => {
            prepend(draft, {
              id: event.properties.messageID,
              type: "shell",
              callID: event.properties.callID,
              command: event.properties.command,
              output: "",
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "session.next.shell.ended":
          update(event.properties.sessionID, (draft) => {
            const match = activeShell(draft, event.properties.callID)
            if (!match) return
            match.output = event.properties.output
            match.time.completed = event.properties.timestamp
          })
          break
        case "session.next.step.started":
          update(event.properties.sessionID, (draft) => {
            if (draft.some((message) => message.id === event.properties.assistantMessageID)) return
            const currentAssistant = activeAssistant(draft)
            if (currentAssistant) currentAssistant.time.completed = event.properties.timestamp
            prepend(draft, {
              id: event.properties.assistantMessageID,
              type: "assistant",
              agent: event.properties.agent,
              model: event.properties.model,
              content: [],
              snapshot: event.properties.snapshot ? { start: event.properties.snapshot } : undefined,
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "session.next.step.ended":
          update(event.properties.sessionID, (draft) => {
            const currentAssistant = ownedAssistant(draft, event.properties.assistantMessageID)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.properties.timestamp
            currentAssistant.finish = event.properties.finish
            currentAssistant.cost = event.properties.cost
            currentAssistant.tokens = event.properties.tokens
            if (event.properties.snapshot)
              currentAssistant.snapshot = { ...currentAssistant.snapshot, end: event.properties.snapshot }
          })
          break
        case "session.next.step.failed":
          update(event.properties.sessionID, (draft) => {
            const currentAssistant = ownedAssistant(draft, event.properties.assistantMessageID)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.properties.timestamp
            currentAssistant.finish = "error"
            currentAssistant.error = event.properties.error
          })
          break
        case "session.next.text.started":
          update(event.properties.sessionID, (draft) => {
            ownedAssistant(draft, event.properties.assistantMessageID)?.content.push({
              type: "text",
              id: event.properties.textID,
              text: "",
            })
          })
          break
        case "session.next.text.delta":
          update(event.properties.sessionID, (draft) => {
            const match = latestText(
              ownedAssistant(draft, event.properties.assistantMessageID),
              event.properties.textID,
            )
            if (match) match.text += event.properties.delta
          })
          break
        case "session.next.text.ended":
          update(event.properties.sessionID, (draft) => {
            const match = latestText(
              ownedAssistant(draft, event.properties.assistantMessageID),
              event.properties.textID,
            )
            if (match) match.text = event.properties.text
          })
          break
        case "session.next.tool.input.started":
          update(event.properties.sessionID, (draft) => {
            ownedAssistant(draft, event.properties.assistantMessageID)?.content.push({
              type: "tool",
              id: event.properties.callID,
              name: event.properties.name,
              time: { created: event.properties.timestamp },
              state: { status: "pending", input: "" },
            })
          })
          break
        case "session.next.tool.input.delta":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(
              ownedAssistant(draft, event.properties.assistantMessageID),
              event.properties.callID,
            )
            if (match?.state.status === "pending") match.state.input += event.properties.delta
          })
          break
        case "session.next.tool.input.ended":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(
              ownedAssistant(draft, event.properties.assistantMessageID),
              event.properties.callID,
            )
            if (match?.state.status === "pending") match.state.input = event.properties.text
          })
          break
        case "session.next.tool.called":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(
              ownedAssistant(draft, event.properties.assistantMessageID),
              event.properties.callID,
            )
            if (!match) return
            match.time.ran = event.properties.timestamp
            match.provider = event.properties.provider
            match.state = { status: "running", input: event.properties.input, structured: {}, content: [] }
          })
          break
        case "session.next.tool.progress":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(
              ownedAssistant(draft, event.properties.assistantMessageID),
              event.properties.callID,
            )
            if (match?.state.status !== "running") return
            match.state.structured = event.properties.structured
            match.state.content = [...event.properties.content]
          })
          break
        case "session.next.tool.success":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(
              ownedAssistant(draft, event.properties.assistantMessageID),
              event.properties.callID,
            )
            if (match?.state.status !== "running") return
            match.state = {
              status: "completed",
              input: match.state.input,
              structured: event.properties.structured,
              content: [...event.properties.content],
              result: event.properties.result,
            }
            match.provider = {
              executed: event.properties.provider.executed || match.provider?.executed === true,
              metadata: match.provider?.metadata,
              resultMetadata: event.properties.provider.metadata,
            }
            match.time.completed = event.properties.timestamp
          })
          break
        case "session.next.tool.failed":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(
              ownedAssistant(draft, event.properties.assistantMessageID),
              event.properties.callID,
            )
            if (!match || (match.state.status !== "pending" && match.state.status !== "running")) return
            match.state = {
              status: "error",
              error: event.properties.error,
              input: typeof match.state.input === "string" ? {} : match.state.input,
              structured: match.state.status === "running" ? match.state.structured : {},
              content: match.state.status === "running" ? match.state.content : [],
              result: event.properties.result,
            }
            match.provider = {
              executed: event.properties.provider.executed || match.provider?.executed === true,
              metadata: match.provider?.metadata,
              resultMetadata: event.properties.provider.metadata,
            }
            match.time.completed = event.properties.timestamp
          })
          break
        case "session.next.reasoning.started":
          update(event.properties.sessionID, (draft) => {
            ownedAssistant(draft, event.properties.assistantMessageID)?.content.push({
              type: "reasoning",
              id: event.properties.reasoningID,
              text: "",
              providerMetadata: event.properties.providerMetadata,
            })
          })
          break
        case "session.next.reasoning.delta":
          update(event.properties.sessionID, (draft) => {
            const match = latestReasoning(
              ownedAssistant(draft, event.properties.assistantMessageID),
              event.properties.reasoningID,
            )
            if (match) match.text += event.properties.delta
          })
          break
        case "session.next.reasoning.ended":
          update(event.properties.sessionID, (draft) => {
            const match = latestReasoning(
              ownedAssistant(draft, event.properties.assistantMessageID),
              event.properties.reasoningID,
            )
            if (match) {
              match.text = event.properties.text
              if (event.properties.providerMetadata !== undefined)
                match.providerMetadata = event.properties.providerMetadata
            }
          })
          break
        case "session.next.retried":
        case "session.next.compaction.started":
        case "session.next.compaction.delta":
          break
        case "session.next.compaction.ended":
          update(event.properties.sessionID, (draft) => {
            prepend(draft, {
              id: event.properties.messageID,
              type: "compaction",
              reason: event.properties.reason,
              summary: event.properties.text,
              recent: event.properties.recent,
              time: { created: event.properties.timestamp },
            })
          })
          break
      }
    }

    event.subscribe((event) => {
      if (duplicate(event.id)) return
      if ("sessionID" in event.properties && typeof event.properties.sessionID === "string")
        buffering.get(event.properties.sessionID)?.push(event)
      apply(event)
    })

    const result = {
      data: store,
      session: {
        message: {
          sync,
          fromSession(sessionID: string) {
            const messages = store.messages[sessionID]
            if (!messages) return []
            return messages
          },
        },
      },
    }

    return result
  },
})

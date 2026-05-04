import { useEvent } from "@tui/context/event"
import type {
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
  const index = messages.findLastIndex((message) => message.type === "assistant" && !message.time.completed)
  if (index < 0) return
  const assistant = messages[index]
  return assistant?.type === "assistant" ? assistant : undefined
}

function activeCompaction(messages: SessionMessage[]) {
  const index = messages.findLastIndex((message) => message.type === "compaction")
  if (index < 0) return
  const compaction = messages[index]
  return compaction?.type === "compaction" ? compaction : undefined
}

function activeShell(messages: SessionMessage[], callID: string) {
  const index = messages.findLastIndex((message) => message.type === "shell" && message.callID === callID)
  if (index < 0) return
  const shell = messages[index]
  return shell?.type === "shell" ? shell : undefined
}

function latestTool(assistant: SessionMessageAssistant | undefined, callID?: string) {
  return assistant?.content.findLast(
    (item): item is SessionMessageAssistantTool => item.type === "tool" && (callID === undefined || item.id === callID),
  )
}

function latestText(assistant: SessionMessageAssistant | undefined) {
  return assistant?.content.findLast((item): item is SessionMessageAssistantText => item.type === "text")
}

function latestReasoning(assistant: SessionMessageAssistant | undefined, reasoningID: string) {
  return assistant?.content.findLast(
    (item): item is SessionMessageAssistantReasoning => item.type === "reasoning" && item.id === reasoningID,
  )
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

    function update(sessionID: string, fn: (messages: SessionMessage[]) => void) {
      setStore(
        "messages",
        produce((draft) => {
          fn((draft[sessionID] ??= []))
        }),
      )
    }

    event.subscribe((event) => {
      switch (event.type) {
        case "session.next.prompted": {
          update(event.properties.sessionID, (draft) => {
            draft.push({
              id: event.id,
              type: "user",
              text: event.properties.prompt.text,
              files: event.properties.prompt.files,
              agents: event.properties.prompt.agents,
              time: { created: event.properties.timestamp },
            })
          })
          break
        }
        case "session.next.synthetic":
          update(event.properties.sessionID, (draft) => {
            draft.push({
              id: event.id,
              type: "synthetic",
              sessionID: event.properties.sessionID,
              text: event.properties.text,
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "session.next.shell.started":
          update(event.properties.sessionID, (draft) => {
            draft.push({
              id: event.id,
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
            const currentAssistant = activeAssistant(draft)
            if (currentAssistant) currentAssistant.time.completed = event.properties.timestamp
            draft.push({
              id: event.id,
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
            const currentAssistant = activeAssistant(draft)
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
            const currentAssistant = activeAssistant(draft)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.properties.timestamp
            currentAssistant.finish = "error"
            currentAssistant.error = event.properties.error
          })
          break
        case "session.next.text.started":
          update(event.properties.sessionID, (draft) => {
            activeAssistant(draft)?.content.push({ type: "text", text: "" })
          })
          break
        case "session.next.text.delta":
          update(event.properties.sessionID, (draft) => {
            const match = latestText(activeAssistant(draft))
            if (match) match.text += event.properties.delta
          })
          break
        case "session.next.text.ended":
          update(event.properties.sessionID, (draft) => {
            const match = latestText(activeAssistant(draft))
            if (match) match.text = event.properties.text
          })
          break
        case "session.next.tool.input.started":
          update(event.properties.sessionID, (draft) => {
            activeAssistant(draft)?.content.push({
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
            const match = latestTool(activeAssistant(draft), event.properties.callID)
            if (match?.state.status === "pending") match.state.input += event.properties.delta
          })
          break
        case "session.next.tool.input.ended":
          break
        case "session.next.tool.called":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), event.properties.callID)
            if (!match) return
            match.time.ran = event.properties.timestamp
            match.provider = event.properties.provider
            match.state = { status: "running", input: event.properties.input, structured: {}, content: [] }
          })
          break
        case "session.next.tool.progress":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), event.properties.callID)
            if (match?.state.status !== "running") return
            match.state.structured = event.properties.structured
            match.state.content = [...event.properties.content]
          })
          break
        case "session.next.tool.success":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), event.properties.callID)
            if (match?.state.status !== "running") return
            match.state = {
              status: "completed",
              input: match.state.input,
              structured: event.properties.structured,
              content: [...event.properties.content],
            }
            match.provider = event.properties.provider
            match.time.completed = event.properties.timestamp
          })
          break
        case "session.next.tool.failed":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), event.properties.callID)
            if (match?.state.status !== "running") return
            match.state = {
              status: "error",
              error: event.properties.error,
              input: match.state.input,
              structured: match.state.structured,
              content: match.state.content,
            }
            match.provider = event.properties.provider
            match.time.completed = event.properties.timestamp
          })
          break
        case "session.next.reasoning.started":
          update(event.properties.sessionID, (draft) => {
            activeAssistant(draft)?.content.push({
              type: "reasoning",
              id: event.properties.reasoningID,
              text: "",
            })
          })
          break
        case "session.next.reasoning.delta":
          update(event.properties.sessionID, (draft) => {
            const match = latestReasoning(activeAssistant(draft), event.properties.reasoningID)
            if (match) match.text += event.properties.delta
          })
          break
        case "session.next.reasoning.ended":
          update(event.properties.sessionID, (draft) => {
            const match = latestReasoning(activeAssistant(draft), event.properties.reasoningID)
            if (match) match.text = event.properties.text
          })
          break
        case "session.next.retried":
          break
        case "session.next.compaction.started":
          update(event.properties.sessionID, (draft) => {
            draft.push({
              id: event.id,
              type: "compaction",
              reason: event.properties.reason,
              summary: "",
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "session.next.compaction.delta":
          update(event.properties.sessionID, (draft) => {
            const match = activeCompaction(draft)
            if (match) match.summary += event.properties.text
          })
          break
        case "session.next.compaction.ended":
          update(event.properties.sessionID, (draft) => {
            const match = activeCompaction(draft)
            if (!match) return
            match.summary = event.properties.text
            match.include = event.properties.include
          })
          break
      }
    })

    const result = {
      data: store,
      session: {
        message: {
          async sync(sessionID: string) {
            const response = await sdk.client.v2.session.messages({ sessionID })
            setStore("messages", sessionID, reconcile(response.data?.items ?? []))
          },
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

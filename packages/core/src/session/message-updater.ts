import { castDraft, produce, type WritableDraft } from "immer"
import { Effect } from "effect"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"

export type MemoryState = {
  messages: SessionMessage.Message[]
}

export interface Adapter {
  readonly getCurrentAssistant: () => Effect.Effect<SessionMessage.Assistant | undefined>
  readonly getAssistant: (messageID: SessionMessage.ID) => Effect.Effect<SessionMessage.Assistant | undefined>
  readonly getCurrentShell: (callID: string) => Effect.Effect<SessionMessage.Shell | undefined>
  readonly updateAssistant: (assistant: SessionMessage.Assistant) => Effect.Effect<void>
  readonly updateShell: (shell: SessionMessage.Shell) => Effect.Effect<void>
  readonly appendMessage: (message: SessionMessage.Message) => Effect.Effect<void>
}

export function memory(state: MemoryState): Adapter {
  const assistantIndex = (messageID: SessionMessage.ID) =>
    state.messages.findLastIndex((message) => message.id === messageID)
  // A newer step supersedes stale incomplete rows; never resume an older assistant projection.
  const latestAssistantIndex = () => state.messages.findLastIndex((message) => message.type === "assistant")
  const activeShellIndex = (callID: string) =>
    state.messages.findLastIndex((message) => message.type === "shell" && message.callID === callID)

  return {
    getCurrentAssistant() {
      return Effect.sync(() => {
        const index = latestAssistantIndex()
        if (index < 0) return
        const assistant = state.messages[index]
        return assistant?.type === "assistant" && !assistant.time.completed ? assistant : undefined
      })
    },
    getAssistant(messageID) {
      return Effect.sync(() => {
        const index = assistantIndex(messageID)
        if (index < 0) return
        const assistant = state.messages[index]
        return assistant?.type === "assistant" ? assistant : undefined
      })
    },
    getCurrentShell(callID) {
      return Effect.sync(() => {
        const index = activeShellIndex(callID)
        if (index < 0) return
        const shell = state.messages[index]
        return shell?.type === "shell" ? shell : undefined
      })
    },
    updateAssistant(assistant) {
      return Effect.sync(() => {
        const index = assistantIndex(assistant.id)
        if (index < 0) return
        const current = state.messages[index]
        if (current?.type !== "assistant") return
        state.messages[index] = assistant
      })
    },
    updateShell(shell) {
      return Effect.sync(() => {
        const index = activeShellIndex(shell.callID)
        if (index < 0) return
        const current = state.messages[index]
        if (current?.type !== "shell") return
        state.messages[index] = shell
      })
    },
    appendMessage(message) {
      return Effect.sync(() => {
        state.messages.push(message)
      })
    },
  }
}

export function update(adapter: Adapter, event: SessionEvent.Event) {
  type DraftAssistant = WritableDraft<SessionMessage.Assistant>
  type DraftTool = WritableDraft<SessionMessage.AssistantTool>
  type DraftText = WritableDraft<SessionMessage.AssistantText>
  type DraftReasoning = WritableDraft<SessionMessage.AssistantReasoning>

  const latestTool = (assistant: DraftAssistant | undefined, callID?: string) =>
    assistant?.content.findLast(
      (item): item is DraftTool => item.type === "tool" && (callID === undefined || item.id === callID),
    )

  const latestText = (assistant: DraftAssistant | undefined, textID: string) =>
    assistant?.content.findLast((item): item is DraftText => item.type === "text" && item.id === textID)

  const latestReasoning = (assistant: DraftAssistant | undefined, reasoningID: string) =>
    assistant?.content.findLast((item): item is DraftReasoning => item.type === "reasoning" && item.id === reasoningID)

  const updateOwnedAssistant = (messageID: SessionMessage.ID, recipe: (draft: DraftAssistant) => void) =>
    Effect.gen(function* () {
      const assistant = yield* adapter.getAssistant(messageID)
      if (assistant) yield* adapter.updateAssistant(produce(assistant, recipe))
    })

  return Effect.gen(function* () {
    yield* SessionEvent.All.match(event, {
      "agent.selected": (event) => {
        return adapter.appendMessage(
          SessionMessage.AgentSelected.make({
            id: SessionMessage.ID.fromEvent(event.id),
            type: "agent-switched",
            metadata: event.metadata,
            agent: event.data.agent,
            time: { created: event.created },
          }),
        )
      },
      "model.selected": (event) => {
        return adapter.appendMessage(
          SessionMessage.ModelSelected.make({
            id: SessionMessage.ID.fromEvent(event.id),
            type: "model-switched",
            metadata: event.metadata,
            model: event.data.model,
            time: { created: event.created },
          }),
        )
      },
      "session.moved": () => Effect.void,
      renamed: () => Effect.void,
      forked: () => Effect.void,
      "prompt.promoted": () => Effect.void,
      "prompt.admitted": () => Effect.void,
      "execution.settled": () => Effect.void,
      "session.context.updated": (event) =>
        adapter.appendMessage(
          SessionMessage.System.make({
            id: SessionMessage.ID.fromEvent(event.id),
            type: "system",
            text: event.data.text,
            time: { created: event.created },
          }),
        ),
      synthetic: (event) => {
        return adapter.appendMessage(
          SessionMessage.Synthetic.make({
            sessionID: event.data.sessionID,
            text: event.data.text,
            description: event.data.description,
            metadata: event.data.metadata,
            id: SessionMessage.ID.fromEvent(event.id),
            type: "synthetic",
            time: { created: event.created },
          }),
        )
      },
      "skill.activated": (event) => {
        return adapter.appendMessage(
          SessionMessage.Skill.make({
            id: SessionMessage.ID.fromEvent(event.id),
            type: "skill",
            name: event.data.name,
            text: event.data.text,
            time: { created: event.created },
          }),
        )
      },
      "shell.started": (event) => {
        return adapter.appendMessage(
          SessionMessage.Shell.make({
            id: SessionMessage.ID.fromEvent(event.id),
            type: "shell",
            metadata: event.metadata,
            callID: event.data.callID,
            command: event.data.command,
            output: "",
            time: { created: event.created },
          }),
        )
      },
      "shell.ended": (event) => {
        return Effect.gen(function* () {
          const currentShell = yield* adapter.getCurrentShell(event.data.callID)
          if (currentShell) {
            yield* adapter.updateShell(
              produce(currentShell, (draft) => {
                draft.output = event.data.output
                draft.time.completed = event.created
              }),
            )
          }
        })
      },
      "step.started": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                draft.time.completed = event.created
              }),
            )
          }
          yield* adapter.appendMessage(
            SessionMessage.Assistant.make({
              id: event.data.assistantMessageID,
              type: "assistant",
              agent: event.data.agent,
              model: event.data.model,
              time: { created: event.created },
              content: [],
              snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
            }),
          )
        })
      },
      "step.ended": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          draft.time.completed = event.created
          draft.finish = event.data.finish
          draft.cost = event.data.cost
          draft.tokens = event.data.tokens
          if (event.data.snapshot || event.data.files)
            draft.snapshot = {
              ...draft.snapshot,
              end: event.data.snapshot,
              files: event.data.files ? Array.from(event.data.files) : undefined,
            }
        })
      },
      "step.failed": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          draft.time.completed = event.created
          draft.finish = "error"
          draft.error = event.data.error
        })
      },
      "text.started": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          draft.content.push(
            castDraft(SessionMessage.AssistantText.make({ type: "text", id: event.data.textID, text: "" })),
          )
        })
      },
      "text.delta": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestText(draft, event.data.textID)
          if (match) match.text += event.data.delta
        })
      },
      "text.ended": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestText(draft, event.data.textID)
          if (match) match.text = event.data.text
        })
      },
      "tool.input.started": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          draft.content.push(
            castDraft(
              SessionMessage.AssistantTool.make({
                type: "tool",
                id: event.data.callID,
                name: event.data.name,
                time: { created: event.created },
                state: SessionMessage.ToolStatePending.make({ status: "pending", input: "" }),
              }),
            ),
          )
        })
      },
      "tool.input.delta": () => Effect.void,
      "tool.input.ended": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match && match.state.status === "pending") match.state.input = event.data.text
        })
      },
      "tool.called": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match) {
            match.provider = event.data.provider
            match.time.ran = event.created
            match.state = castDraft(
              SessionMessage.ToolStateRunning.make({
                status: "running",
                input: event.data.input,
                structured: {},
                content: [],
              }),
            )
          }
        })
      },
      "tool.progress": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match && match.state.status === "running") {
            match.state.structured = event.data.structured
            match.state.content = [...event.data.content]
          }
        })
      },
      "tool.success": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match && match.state.status === "running") {
            match.provider = {
              executed: event.data.provider.executed || match.provider?.executed === true,
              metadata: match.provider?.metadata,
              resultMetadata: event.data.provider.metadata,
            }
            match.time.completed = event.created
            match.state = castDraft(
              SessionMessage.ToolStateCompleted.make({
                status: "completed",
                input: match.state.input,
                structured: event.data.structured,
                content: [...event.data.content],
                outputPaths: event.data.outputPaths ? [...event.data.outputPaths] : [],
                result: event.data.result,
              }),
            )
          }
        })
      },
      "tool.failed": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match && (match.state.status === "pending" || match.state.status === "running")) {
            match.provider = {
              executed: event.data.provider.executed || match.provider?.executed === true,
              metadata: match.provider?.metadata,
              resultMetadata: event.data.provider.metadata,
            }
            match.time.completed = event.created
            match.state = castDraft(
              SessionMessage.ToolStateError.make({
                status: "error",
                error: event.data.error,
                input: typeof match.state.input === "string" ? {} : match.state.input,
                structured: match.state.status === "running" ? match.state.structured : {},
                content: match.state.status === "running" ? match.state.content : [],
                result: event.data.result,
              }),
            )
          }
        })
      },
      "reasoning.started": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          draft.content.push(
            castDraft(
              SessionMessage.AssistantReasoning.make({
                type: "reasoning",
                id: event.data.reasoningID,
                text: "",
                providerMetadata: event.data.providerMetadata,
                time: { created: event.created },
              }),
            ),
          )
        })
      },
      "reasoning.delta": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestReasoning(draft, event.data.reasoningID)
          if (match) match.text += event.data.delta
        })
      },
      "reasoning.ended": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestReasoning(draft, event.data.reasoningID)
          if (match) {
            match.text = event.data.text
            match.time = { created: match.time?.created ?? event.created, completed: event.created }
            if (event.data.providerMetadata !== undefined) match.providerMetadata = event.data.providerMetadata
          }
        })
      },
      retried: () => Effect.void,
      "compaction.started": () => Effect.void,
      "compaction.delta": () => Effect.void,
      "compaction.ended": (event) => {
        return adapter.appendMessage(
          SessionMessage.Compaction.make({
            id: SessionMessage.ID.fromEvent(event.id),
            type: "compaction",
            metadata: event.metadata,
            reason: event.data.reason,
            summary: event.data.text,
            recent: event.data.recent,
            time: { created: event.created },
          }),
        )
      },
      "revert.staged": () => Effect.void,
      "revert.cleared": () => Effect.void,
      "revert.committed": () => Effect.void,
    })
  })
}

export * as SessionMessageUpdater from "./message-updater"

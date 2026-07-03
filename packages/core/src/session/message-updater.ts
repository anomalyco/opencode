import { castDraft, produce, type WritableDraft } from "immer"
import { Effect } from "effect"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"

export type MemoryState = {
  messages: SessionMessage.Message[]
}

export interface Adapter {
  readonly getCurrentAssistant: () => Effect.Effect<SessionMessage.Assistant | undefined, never, never>
  readonly getAssistant: (
    messageID: SessionMessage.ID,
  ) => Effect.Effect<SessionMessage.Assistant | undefined, never, never>
  readonly getShell: (
    shellID: SessionMessage.Shell["shell"]["id"],
  ) => Effect.Effect<SessionMessage.Shell | undefined, never, never>
  readonly updateAssistant: (assistant: SessionMessage.Assistant) => Effect.Effect<void, never, never>
  readonly updateShell: (shell: SessionMessage.Shell) => Effect.Effect<void, never, never>
  readonly appendMessage: (message: SessionMessage.Message) => Effect.Effect<void, never, never>
}

export function memory(state: MemoryState): Adapter {
  const assistantIndex = (messageID: SessionMessage.ID) =>
    state.messages.findLastIndex((message) => message.id === messageID)
  const shellIndex = (messageID: SessionMessage.ID) =>
    state.messages.findLastIndex((message) => message.id === messageID)
  // A newer step supersedes stale incomplete rows; never resume an older assistant projection.
  const latestAssistantIndex = () => state.messages.findLastIndex((message) => message.type === "assistant")

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
    getShell(shellID) {
      return Effect.sync(() => {
        return state.messages.find((message): message is SessionMessage.Shell => {
          return message.type === "shell" && message.shell.id === shellID
        })
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
        const index = shellIndex(shell.id)
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
      "session.agent.selected": (event) => {
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
      "session.model.selected": (event) => {
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
      "session.renamed": () => Effect.void,
      "session.forked": () => Effect.void,
      "session.prompt.promoted": () => Effect.void,
      "session.prompt.admitted": () => Effect.void,
      "session.execution.settled": () => Effect.void,
      "session.context.updated": (event) =>
        adapter.appendMessage(
          SessionMessage.System.make({
            id: SessionMessage.ID.fromEvent(event.id),
            type: "system",
            text: event.data.text,
            time: { created: event.created },
          }),
        ),
      "session.synthetic": (event) => {
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
      "session.skill.activated": (event) => {
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
      "session.shell.started": (event) => {
        return adapter.appendMessage(
          SessionMessage.Shell.make({
            id: SessionMessage.ID.fromEvent(event.id),
            type: "shell",
            metadata: event.metadata,
            shell: event.data.shell,
            time: { created: event.created },
          }),
        )
      },
      "session.shell.ended": (event) => {
        return Effect.gen(function* () {
          const currentShell = yield* adapter.getShell(event.data.shell.id)
          if (currentShell) {
            yield* adapter.updateShell(
              produce(currentShell, (draft) => {
                draft.shell = castDraft(event.data.shell)
                draft.output = event.data.output
                draft.time.completed = event.created
              }),
            )
          }
        })
      },
      "session.step.started": (event) => {
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
      "session.step.ended": (event) => {
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
      "session.step.failed": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          draft.time.completed = event.created
          draft.finish = "error"
          draft.error = event.data.error
        })
      },
      "session.text.started": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          draft.content.push(
            castDraft(SessionMessage.AssistantText.make({ type: "text", id: event.data.textID, text: "" })),
          )
        })
      },
      "session.text.delta": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestText(draft, event.data.textID)
          if (match) match.text += event.data.delta
        })
      },
      "session.text.ended": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestText(draft, event.data.textID)
          if (match) match.text = event.data.text
        })
      },
      "session.tool.input.started": (event) => {
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
      "session.tool.input.delta": () => Effect.void,
      "session.tool.input.ended": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match && match.state.status === "pending") match.state.input = event.data.text
        })
      },
      "session.tool.called": (event) => {
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
      "session.tool.progress": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match && match.state.status === "running") {
            match.state.structured = event.data.structured
            match.state.content = [...event.data.content]
          }
        })
      },
      "session.tool.success": (event) => {
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
      "session.tool.failed": (event) => {
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
      "session.reasoning.started": (event) => {
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
      "session.reasoning.delta": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestReasoning(draft, event.data.reasoningID)
          if (match) match.text += event.data.delta
        })
      },
      "session.reasoning.ended": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestReasoning(draft, event.data.reasoningID)
          if (match) {
            match.text = event.data.text
            match.time = { created: match.time?.created ?? event.created, completed: event.created }
            if (event.data.providerMetadata !== undefined) match.providerMetadata = event.data.providerMetadata
          }
        })
      },
      "session.retried": () => Effect.void,
      "session.compaction.started": () => Effect.void,
      "session.compaction.delta": () => Effect.void,
      "session.compaction.ended": (event) => {
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
      "session.revert.staged": () => Effect.void,
      "session.revert.cleared": () => Effect.void,
      "session.revert.committed": () => Effect.void,
    })
  })
}

export * as SessionMessageUpdater from "./message-updater"

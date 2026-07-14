import { castDraft, produce, type WritableDraft } from "immer"
import { DateTime, Effect } from "effect"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"

export type MemoryState = {
  messages: SessionMessage.Info[]
}

export interface Adapter {
  readonly getModel: () => Effect.Effect<SessionMessage.ModelSelected["model"] | undefined, never, never>
  readonly getCurrentAssistant: () => Effect.Effect<SessionMessage.Assistant | undefined, never, never>
  readonly getAssistant: (
    messageID: SessionMessage.ID,
  ) => Effect.Effect<SessionMessage.Assistant | undefined, never, never>
  readonly getShell: (
    shellID: SessionMessage.Shell["shellID"],
  ) => Effect.Effect<SessionMessage.Shell | undefined, never, never>
  readonly getCompaction: () => Effect.Effect<SessionMessage.Compaction | undefined, never, never>
  readonly updateAssistant: (assistant: SessionMessage.Assistant) => Effect.Effect<void, never, never>
  readonly updateShell: (shell: SessionMessage.Shell) => Effect.Effect<void, never, never>
  readonly updateCompaction: (compaction: SessionMessage.Compaction) => Effect.Effect<void, never, never>
  readonly appendMessage: (message: SessionMessage.Info) => Effect.Effect<void, never, never>
}

export function memory(state: MemoryState): Adapter {
  const assistantIndex = (messageID: SessionMessage.ID) =>
    state.messages.findLastIndex((message) => message.id === messageID)
  const shellIndex = (messageID: SessionMessage.ID) =>
    state.messages.findLastIndex((message) => message.id === messageID)
  const compactionIndex = () =>
    state.messages.findLastIndex((message) => message.type === "compaction" && message.status === "running")
  // A newer step supersedes stale incomplete rows; never resume an older assistant projection.
  const latestAssistantIndex = () => state.messages.findLastIndex((message) => message.type === "assistant")

  return {
    getModel() {
      return Effect.sync(
        () =>
          state.messages.findLast(
            (message): message is SessionMessage.ModelSelected | SessionMessage.Assistant =>
              message.type === "model-switched" || message.type === "assistant",
          )?.model,
      )
    },
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
          return message.type === "shell" && message.shellID === shellID
        })
      })
    },
    getCompaction() {
      return Effect.sync(() => {
        const index = compactionIndex()
        const message = state.messages[index]
        return message?.type === "compaction" ? message : undefined
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
    updateCompaction(compaction) {
      return Effect.sync(() => {
        const index = state.messages.findLastIndex((message) => message.id === compaction.id)
        if (index >= 0) state.messages[index] = compaction
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

  const latestText = (assistant: DraftAssistant | undefined) =>
    assistant?.content.findLast((item): item is DraftText => item.type === "text")

  const latestReasoning = (assistant: DraftAssistant | undefined) =>
    assistant?.content.findLast((item): item is DraftReasoning => item.type === "reasoning" && !item.time?.completed)

  const updateOwnedAssistant = (messageID: SessionMessage.ID, recipe: (draft: DraftAssistant) => void) =>
    Effect.gen(function* () {
      const assistant = yield* adapter.getAssistant(messageID)
      if (assistant) yield* adapter.updateAssistant(produce(assistant, recipe))
    })

  const clearCurrentRetry = Effect.gen(function* () {
    const assistant = yield* adapter.getCurrentAssistant()
    if (assistant?.retry) {
      yield* adapter.updateAssistant(
        produce(assistant, (draft) => {
          draft.retry = undefined
        }),
      )
    }
  })

  return Effect.gen(function* () {
    yield* SessionEvent.All.match(event, {
      "session.usage.updated": () => Effect.void,
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
        return Effect.gen(function* () {
          const previous = yield* adapter.getModel()
          yield* adapter.appendMessage(
            SessionMessage.ModelSelected.make({
              id: SessionMessage.ID.fromEvent(event.id),
              type: "model-switched",
              metadata: event.metadata,
              model: event.data.model,
              previous,
              time: { created: event.created },
            }),
          )
        })
      },
      "session.moved": () => Effect.void,
      "session.renamed": () => Effect.void,
      "session.deleted": () => Effect.void,
      "session.forked": () => Effect.void,
      "session.input.promoted": () => Effect.void,
      "session.input.admitted": () => Effect.void,
      "session.execution.started": () => Effect.void,
      "session.execution.succeeded": () => clearCurrentRetry,
      "session.execution.failed": () => clearCurrentRetry,
      "session.execution.interrupted": () => clearCurrentRetry,
      "session.instructions.updated": () => Effect.void,
      "session.synthetic": (event) => {
        return adapter.appendMessage(
          SessionMessage.Synthetic.make({
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
            skill: event.data.id,
            name: event.data.name,
            text: event.data.text,
            metadata: event.metadata,
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
            shellID: event.data.shell.id,
            command: event.data.shell.command,
            status: event.data.shell.status,
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
                draft.status = event.data.shell.status
                draft.exit = event.data.shell.exit
                draft.output = event.data.output
                draft.time.completed = event.created
              }),
            )
          }
        })
      },
      "session.step.started": (event) => {
        return Effect.gen(function* () {
          const existing = yield* adapter.getAssistant(event.data.assistantMessageID)
          if (existing) {
            yield* adapter.updateAssistant(
              produce(existing, (draft) => {
                draft.agent = event.data.agent
                draft.model = castDraft(event.data.model)
                draft.retry = undefined
                draft.error = undefined
                draft.finish = undefined
                draft.time.completed = undefined
                if (event.data.snapshot) draft.snapshot = { ...draft.snapshot, start: event.data.snapshot }
              }),
            )
            return
          }
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                draft.retry = undefined
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
              metadata: event.metadata,
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
          draft.error = castDraft(event.data.error)
          draft.retry = undefined
          if (event.data.cost !== undefined && event.data.tokens !== undefined) {
            draft.cost = event.data.cost
            draft.tokens = castDraft(event.data.tokens)
          }
        })
      },
      "session.text.started": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          draft.content.push(castDraft(SessionMessage.AssistantText.make({ type: "text", text: "" })))
        })
      },
      "session.text.delta": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestText(draft)
          if (match) match.text += event.data.delta
        })
      },
      "session.text.ended": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestText(draft)
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
                state: SessionMessage.ToolStateStreaming.make({ status: "streaming", input: "" }),
              }),
            ),
          )
        })
      },
      "session.tool.input.delta": () => Effect.void,
      "session.tool.input.ended": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match && match.state.status === "streaming") match.state.input = event.data.text
        })
      },
      "session.tool.called": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match) {
            match.executed = event.data.executed
            match.providerState = event.data.state
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
            match.executed = event.data.executed || match.executed === true
            match.providerResultState = event.data.resultState
            match.time.completed = event.created
            match.state = castDraft(
              SessionMessage.ToolStateCompleted.make({
                status: "completed",
                input: match.state.input,
                structured: event.data.structured,
                content: [...event.data.content],
                result: event.data.result,
              }),
            )
          }
        })
      },
      "session.tool.failed": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match && (match.state.status === "streaming" || match.state.status === "running")) {
            match.executed = event.data.executed || match.executed === true
            match.providerResultState = event.data.resultState
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
                text: "",
                state: event.data.state,
                time: { created: event.created },
              }),
            ),
          )
        })
      },
      "session.reasoning.delta": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestReasoning(draft)
          if (match) match.text += event.data.delta
        })
      },
      "session.reasoning.ended": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestReasoning(draft)
          if (match) {
            match.text = event.data.text
            match.time = { created: match.time?.created ?? event.created, completed: event.created }
            if (event.data.state !== undefined) match.state = event.data.state
          }
        })
      },
      "session.retry.scheduled": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          draft.retry = {
            attempt: event.data.attempt,
            at: DateTime.makeUnsafe(event.data.at),
            error: castDraft(event.data.error),
          }
        })
      },
      "session.compaction.admitted": () => Effect.void,
      "session.compaction.started": (event) =>
        adapter.appendMessage(
          SessionMessage.CompactionRunning.make({
            id: event.data.inputID ?? SessionMessage.ID.fromEvent(event.id),
            type: "compaction",
            status: "running",
            metadata: event.metadata,
            reason: event.data.reason,
            summary: "",
            recent: event.data.recent ?? "",
            time: { created: event.created },
          }),
        ),
      "session.compaction.delta": (event) =>
        Effect.gen(function* () {
          const current = yield* adapter.getCompaction()
          if (current?.status !== "running") return
          yield* adapter.updateCompaction({ ...current, summary: current.summary + event.data.text })
        }),
      "session.compaction.ended": (event) => {
        return Effect.gen(function* () {
          const current = yield* adapter.getCompaction()
          if (current?.status === "running") {
            yield* adapter.updateCompaction({
              ...current,
              status: "completed",
              reason: event.data.reason,
              summary: event.data.text,
              recent: event.data.recent,
            })
            return
          }
          yield* adapter.appendMessage(
            SessionMessage.Compaction.make({
              id: SessionMessage.ID.fromEvent(event.id),
              type: "compaction",
              status: "completed",
              metadata: event.metadata,
              reason: event.data.reason,
              summary: event.data.text,
              recent: event.data.recent,
              time: { created: event.created },
            }),
          )
        })
      },
      "session.compaction.failed": (event) =>
        Effect.gen(function* () {
          const current = yield* adapter.getCompaction()
          const failed = SessionMessage.CompactionFailed.make({
            id: current?.id ?? event.data.inputID ?? SessionMessage.ID.fromEvent(event.id),
            type: "compaction",
            status: "failed",
            metadata: current?.metadata ?? event.metadata,
            reason: event.data.reason,
            error: event.data.error,
            time: current?.time ?? { created: event.created },
          })
          if (current?.status === "running") return yield* adapter.updateCompaction(failed)
          yield* adapter.appendMessage(failed)
        }),
      "session.revert.staged": () => Effect.void,
      "session.revert.cleared": () => Effect.void,
      "session.revert.committed": () => Effect.void,
    })
  })
}

export * as SessionMessageUpdater from "./message-updater"

import { produce, type WritableDraft } from "immer"
import { Effect } from "effect"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"

export type MemoryState = {
  messages: SessionMessage.Message[]
}

export interface Adapter {
  readonly getCurrentAssistant: () => Effect.Effect<SessionMessage.Assistant | undefined>
  readonly getCurrentCompaction: () => Effect.Effect<SessionMessage.Compaction | undefined>
  readonly getCurrentShell: (callID: string) => Effect.Effect<SessionMessage.Shell | undefined>
  readonly updateAssistant: (assistant: SessionMessage.Assistant) => Effect.Effect<void>
  readonly updateCompaction: (compaction: SessionMessage.Compaction) => Effect.Effect<void>
  readonly updateShell: (shell: SessionMessage.Shell) => Effect.Effect<void>
  readonly appendMessage: (message: SessionMessage.Message) => Effect.Effect<void>
}

export function memory(state: MemoryState): Adapter {
  const activeAssistantIndex = () =>
    state.messages.findLastIndex((message) => message.type === "assistant" && !message.time.completed)
  const activeCompactionIndex = () => state.messages.findLastIndex((message) => message.type === "compaction")
  const activeShellIndex = (callID: string) =>
    state.messages.findLastIndex((message) => message.type === "shell" && message.callID === callID)

  return {
    getCurrentAssistant() {
      return Effect.sync(() => {
        const index = activeAssistantIndex()
        if (index < 0) return
        const assistant = state.messages[index]
        return assistant?.type === "assistant" ? assistant : undefined
      })
    },
    getCurrentCompaction() {
      return Effect.sync(() => {
        const index = activeCompactionIndex()
        if (index < 0) return
        const compaction = state.messages[index]
        return compaction?.type === "compaction" ? compaction : undefined
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
        const index = activeAssistantIndex()
        if (index < 0) return
        const current = state.messages[index]
        if (current?.type !== "assistant") return
        state.messages[index] = assistant
      })
    },
    updateCompaction(compaction) {
      return Effect.sync(() => {
        const index = activeCompactionIndex()
        if (index < 0) return
        const current = state.messages[index]
        if (current?.type !== "compaction") return
        state.messages[index] = compaction
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

  const latestText = (assistant: DraftAssistant | undefined) =>
    assistant?.content.findLast((item): item is DraftText => item.type === "text")

  const latestReasoning = (assistant: DraftAssistant | undefined, reasoningID: string) =>
    assistant?.content.findLast((item): item is DraftReasoning => item.type === "reasoning" && item.id === reasoningID)

  return Effect.gen(function* () {
    yield* SessionEvent.All.match(event, {
      "session.next.agent.switched": (event) => {
        return adapter.appendMessage(
          new SessionMessage.AgentSwitched({
            id: event.id,
            type: "agent-switched",
            metadata: event.metadata,
            agent: event.data.agent,
            time: { created: event.data.timestamp },
          }),
        )
      },
      "session.next.model.switched": (event) => {
        return adapter.appendMessage(
          new SessionMessage.ModelSwitched({
            id: event.id,
            type: "model-switched",
            metadata: event.metadata,
            model: event.data.model,
            time: { created: event.data.timestamp },
          }),
        )
      },
      "session.next.prompted": (event) => {
        return adapter.appendMessage(
          new SessionMessage.User({
            id: event.id,
            type: "user",
            metadata: event.metadata,
            text: event.data.prompt.text,
            files: event.data.prompt.files,
            agents: event.data.prompt.agents,
            references: event.data.prompt.references,
            time: { created: event.data.timestamp },
          }),
        )
      },
      "session.next.synthetic": (event) => {
        return adapter.appendMessage(
          new SessionMessage.Synthetic({
            sessionID: event.data.sessionID,
            text: event.data.text,
            id: event.id,
            type: "synthetic",
            time: { created: event.data.timestamp },
          }),
        )
      },
      "session.next.shell.started": (event) => {
        return adapter.appendMessage(
          new SessionMessage.Shell({
            id: event.id,
            type: "shell",
            metadata: event.metadata,
            callID: event.data.callID,
            command: event.data.command,
            output: "",
            time: { created: event.data.timestamp },
          }),
        )
      },
      "session.next.shell.ended": (event) => {
        return Effect.gen(function* () {
          const currentShell = yield* adapter.getCurrentShell(event.data.callID)
          if (currentShell) {
            yield* adapter.updateShell(
              produce(currentShell, (draft) => {
                draft.output = event.data.output
                draft.time.completed = event.data.timestamp
              }),
            )
          }
        })
      },
      "session.next.step.started": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                draft.time.completed = event.data.timestamp
              }),
            )
          }
          yield* adapter.appendMessage(
            new SessionMessage.Assistant({
              id: event.id,
              type: "assistant",
              agent: event.data.agent,
              model: event.data.model,
              time: { created: event.data.timestamp },
              content: [],
              snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
            }),
          )
        })
      },
      "session.next.step.ended": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                draft.time.completed = event.data.timestamp
                draft.finish = event.data.finish
                draft.cost = event.data.cost
                draft.tokens = event.data.tokens
                if (event.data.snapshot) draft.snapshot = { ...draft.snapshot, end: event.data.snapshot }
              }),
            )
          }
        })
      },
      "session.next.step.failed": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                draft.time.completed = event.data.timestamp
                draft.finish = "error"
                draft.error = event.data.error
              }),
            )
          }
        })
      },
      "session.next.text.started": () => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                draft.content.push(new SessionMessage.AssistantText({ type: "text", text: "" }) as DraftText)
              }),
            )
          }
        })
      },
      "session.next.text.delta": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                const match = latestText(draft)
                if (match) match.text += event.data.delta
              }),
            )
          }
        })
      },
      "session.next.text.ended": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                const match = latestText(draft)
                if (match) match.text = event.data.text
              }),
            )
          }
        })
      },
      "session.next.tool.input.started": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                draft.content.push(
                  new SessionMessage.AssistantTool({
                    type: "tool",
                    id: event.data.callID,
                    name: event.data.name,
                    time: { created: event.data.timestamp },
                    state: new SessionMessage.ToolStatePending({ status: "pending", input: "" }),
                  }) as DraftTool,
                )
              }),
            )
          }
        })
      },
      "session.next.tool.input.delta": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                const match = latestTool(draft, event.data.callID)
                // oxlint-disable-next-line no-base-to-string -- event.delta is a Schema.String (runtime string)
                if (match && match.state.status === "pending") match.state.input += event.data.delta
              }),
            )
          }
        })
      },
      "session.next.tool.input.ended": () => Effect.void,
      "session.next.tool.called": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                const match = latestTool(draft, event.data.callID)
                if (match) {
                  match.provider = event.data.provider
                  match.time.ran = event.data.timestamp
                  match.state = {
                    status: "running",
                    input: event.data.input,
                    structured: {},
                    content: [],
                  }
                }
              }),
            )
          }
        })
      },
      "session.next.tool.progress": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                const match = latestTool(draft, event.data.callID)
                if (match && match.state.status === "running") {
                  match.state.structured = event.data.structured
                  match.state.content = [...event.data.content]
                }
              }),
            )
          }
        })
      },
      "session.next.tool.success": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                const match = latestTool(draft, event.data.callID)
                if (match && match.state.status === "running") {
                  match.provider = event.data.provider
                  match.time.completed = event.data.timestamp
                  match.state = {
                    status: "completed",
                    input: match.state.input,
                    structured: event.data.structured,
                    content: [...event.data.content],
                  }
                }
              }),
            )
          }
        })
      },
      "session.next.tool.failed": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                const match = latestTool(draft, event.data.callID)
                if (match && match.state.status === "running") {
                  match.provider = event.data.provider
                  match.time.completed = event.data.timestamp
                  match.state = {
                    status: "error",
                    error: event.data.error,
                    input: match.state.input,
                    structured: match.state.structured,
                    content: match.state.content,
                  }
                }
              }),
            )
          }
        })
      },
      "session.next.reasoning.started": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                draft.content.push(
                  new SessionMessage.AssistantReasoning({
                    type: "reasoning",
                    id: event.data.reasoningID,
                    text: "",
                  }) as DraftReasoning,
                )
              }),
            )
          }
        })
      },
      "session.next.reasoning.delta": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                const match = latestReasoning(draft, event.data.reasoningID)
                if (match) match.text += event.data.delta
              }),
            )
          }
        })
      },
      "session.next.reasoning.ended": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                const match = latestReasoning(draft, event.data.reasoningID)
                if (match) match.text = event.data.text
              }),
            )
          }
        })
      },
      "session.next.retried": () => Effect.void,
      "session.next.compaction.started": (event) => {
        return adapter.appendMessage(
          new SessionMessage.Compaction({
            id: event.id,
            type: "compaction",
            metadata: event.metadata,
            reason: event.data.reason,
            summary: "",
            time: { created: event.data.timestamp },
          }),
        )
      },
      "session.next.compaction.delta": (event) => {
        return Effect.gen(function* () {
          const currentCompaction = yield* adapter.getCurrentCompaction()
          if (currentCompaction) {
            yield* adapter.updateCompaction(
              produce(currentCompaction, (draft) => {
                draft.summary += event.data.text
              }),
            )
          }
        })
      },
      "session.next.compaction.ended": (event) => {
        return Effect.gen(function* () {
          const currentCompaction = yield* adapter.getCurrentCompaction()
          if (currentCompaction) {
            yield* adapter.updateCompaction(
              produce(currentCompaction, (draft) => {
                draft.summary = event.data.text
                draft.include = event.data.include
              }),
            )
          }
        })
      },
    })
  })
}

export * as SessionMessageUpdater from "./message-updater"

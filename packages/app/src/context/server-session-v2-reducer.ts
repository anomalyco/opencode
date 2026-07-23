import type { OpenCodeEvent, SessionMessageInfo, SessionPendingMessage } from "@opencode-ai/client/promise"

type Assistant = Extract<SessionMessageInfo, { type: "assistant" }>
type Compaction = Extract<SessionMessageInfo, { type: "compaction" }>
type Shell = Extract<SessionMessageInfo, { type: "shell" }>

export type V2SessionReduction = {
  sessionID: string
  messages: SessionMessageInfo[]
  touched: string[]
  missing?: string
}

export function createV2SessionReducer() {
  const pending = new Map<string, SessionPendingMessage>()

  const reduce = (source: readonly SessionMessageInfo[], event: OpenCodeEvent): V2SessionReduction | undefined => {
    if (!("data" in event) || !("sessionID" in event.data) || typeof event.data.sessionID !== "string") return
    const sessionID = event.data.sessionID
    const result = (messages: SessionMessageInfo[], touched: string[] = []): V2SessionReduction => ({
      sessionID,
      messages,
      touched,
    })
    const append = (message: SessionMessageInfo) =>
      result(source.some((item) => item.id === message.id) ? [...source] : [...source, message], [message.id])

    switch (event.type) {
      case "session.input.admitted":
        pending.set(key(sessionID, event.data.inputID), event.data.input)
        return result([...source])
      case "session.input.promoted": {
        const input = pending.get(key(sessionID, event.data.inputID))
        pending.delete(key(sessionID, event.data.inputID))
        if (!input) return { ...result([...source]), missing: event.data.inputID }
        if (input.type === "user")
          return append({
            id: event.data.inputID,
            type: "user",
            metadata: input.data.metadata,
            text: input.data.text,
            files: input.data.files,
            agents: input.data.agents,
            time: { created: event.created },
          })
        return append({
          id: event.data.inputID,
          type: "synthetic",
          metadata: input.data.metadata,
          text: input.data.text,
          description: input.data.description,
          time: { created: event.created },
        })
      }
      case "session.agent.selected":
        return append({
          id: messageID(event.id),
          type: "agent-switched",
          metadata: event.metadata,
          agent: event.data.agent,
          time: { created: event.created },
        })
      case "session.model.selected":
        return append({
          id: messageID(event.id),
          type: "model-switched",
          metadata: event.metadata,
          model: event.data.model,
          previous: source.findLast(
            (item): item is Extract<SessionMessageInfo, { type: "model-switched" | "assistant" }> =>
              item.type === "model-switched" || item.type === "assistant",
          )?.model,
          time: { created: event.created },
        })
      case "session.synthetic":
        return append({
          id: messageID(event.id),
          type: "synthetic",
          metadata: event.data.metadata,
          text: event.data.text,
          description: event.data.description,
          time: { created: event.created },
        })
      case "session.skill.activated":
        return append({
          id: messageID(event.id),
          type: "skill",
          metadata: event.metadata,
          skill: event.data.id,
          name: event.data.name,
          text: event.data.text,
          time: { created: event.created },
        })
      case "session.shell.started":
        return append({
          id: messageID(event.id),
          type: "shell",
          metadata: event.metadata,
          shellID: event.data.shell.id,
          command: event.data.shell.command,
          status: event.data.shell.status,
          exit: event.data.shell.exit,
          time: { created: event.created },
        })
      case "session.shell.ended":
        return updateMessage<Shell>(source, (item): item is Shell => item.type === "shell" && item.shellID === event.data.shell.id, (item) => ({
          ...item,
          status: event.data.shell.status,
          exit: event.data.shell.exit,
          output: event.data.output,
          time: { ...item.time, completed: event.created },
        }), sessionID)
      case "session.step.started": {
        const current = source.findLast((item): item is Assistant => item.type === "assistant" && !item.time.completed)
        const completed = current && current.id !== event.data.assistantMessageID
          ? update(source, current.id, (item) => item.type === "assistant" ? { ...item, retry: undefined, time: { ...item.time, completed: event.created } } : item)
          : [...source]
        const existing = completed.find((item) => item.id === event.data.assistantMessageID)
        if (existing?.type === "assistant")
          return result(update(completed, existing.id, (item) => item.type === "assistant" ? {
            ...item,
            agent: event.data.agent,
            model: event.data.model,
            retry: undefined,
            error: undefined,
            finish: undefined,
            snapshot: event.data.snapshot ? { ...item.snapshot, start: event.data.snapshot } : item.snapshot,
            time: { ...item.time, completed: undefined },
          } : item), current && current.id !== existing.id ? [current.id, existing.id] : [existing.id])
        return result([...completed, {
          id: event.data.assistantMessageID,
          type: "assistant",
          metadata: event.metadata,
          agent: event.data.agent,
          model: event.data.model,
          content: [],
          snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
          time: { created: event.created },
        }], current ? [current.id, event.data.assistantMessageID] : [event.data.assistantMessageID])
      }
      case "session.step.ended":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          finish: event.data.finish,
          cost: event.data.cost,
          tokens: event.data.tokens,
          snapshot: event.data.snapshot || event.data.files
            ? { ...item.snapshot, end: event.data.snapshot, files: event.data.files }
            : item.snapshot,
          time: { ...item.time, completed: event.created },
        }))
      case "session.step.failed":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          finish: "error",
          error: event.data.error,
          retry: undefined,
          cost: event.data.cost ?? item.cost,
          tokens: event.data.tokens ?? item.tokens,
          snapshot: event.data.snapshot || event.data.files
            ? { ...item.snapshot, end: event.data.snapshot, files: event.data.files }
            : item.snapshot,
          time: { ...item.time, completed: event.created },
        }))
      case "session.text.started":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: insertOrdinal(item.content, "text", event.data.ordinal, { type: "text", text: "" }),
        }))
      case "session.text.delta":
        return updateContent(source, event.data.assistantMessageID, sessionID, "text", event.data.ordinal, (item) => ({
          ...item,
          text: item.text + event.data.delta,
        }))
      case "session.text.ended":
        return updateContent(source, event.data.assistantMessageID, sessionID, "text", event.data.ordinal, (item) => ({
          ...item,
          text: event.data.text,
        }))
      case "session.reasoning.started":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: insertOrdinal(item.content, "reasoning", event.data.ordinal, {
            type: "reasoning",
            text: "",
            state: event.data.state,
            time: { created: event.created },
          }),
        }))
      case "session.reasoning.delta":
        return updateContent(source, event.data.assistantMessageID, sessionID, "reasoning", event.data.ordinal, (item) => ({
          ...item,
          text: item.text + event.data.delta,
        }))
      case "session.reasoning.ended":
        return updateContent(source, event.data.assistantMessageID, sessionID, "reasoning", event.data.ordinal, (item) => ({
          ...item,
          text: event.data.text,
          state: event.data.state ?? item.state,
          time: { created: item.time?.created ?? event.created, completed: event.created },
        }))
      case "session.tool.input.started":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: item.content.some((content) => content.type === "tool" && content.id === event.data.callID)
            ? item.content
            : [...item.content, {
                type: "tool",
                id: event.data.callID,
                name: event.data.name,
                state: { status: "streaming", input: "" },
                time: { created: event.created },
              }],
        }))
      case "session.tool.input.delta":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "streaming"
            ? { ...tool, state: { ...tool.state, input: tool.state.input + event.data.delta } }
            : tool,
        )
      case "session.tool.input.ended":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "streaming" ? { ...tool, state: { ...tool.state, input: event.data.text } } : tool,
        )
      case "session.tool.called":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => ({
          ...tool,
          executed: event.data.executed,
          providerState: event.data.state,
          state: { status: "running", input: event.data.input, structured: {}, content: [] },
          time: { ...tool.time, ran: event.created },
        }))
      case "session.tool.progress":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "running"
            ? { ...tool, state: { ...tool.state, structured: event.data.structured, content: event.data.content } }
            : tool,
        )
      case "session.tool.success":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => {
          if (tool.state.status !== "running") return tool
          return {
            ...tool,
            executed: event.data.executed || tool.executed === true,
            providerResultState: event.data.resultState,
            state: {
              status: "completed",
              input: tool.state.input,
              structured: event.data.structured,
              content: event.data.content,
              result: event.data.result,
            },
            time: { ...tool.time, completed: event.created },
          }
        })
      case "session.tool.failed":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => {
          if (tool.state.status !== "streaming" && tool.state.status !== "running") return tool
          return {
            ...tool,
            executed: event.data.executed || tool.executed === true,
            providerResultState: event.data.resultState,
            state: {
              status: "error",
              input: typeof tool.state.input === "string" ? {} : tool.state.input,
              structured: tool.state.status === "running" ? tool.state.structured : {},
              content: tool.state.status === "running" ? tool.state.content : [],
              error: event.data.error,
              result: event.data.result,
            },
            time: { ...tool.time, completed: event.created },
          }
        })
      case "session.retry.scheduled":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          retry: { attempt: event.data.attempt, at: event.data.at, error: event.data.error },
        }))
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        const current = source.findLast((item): item is Assistant => item.type === "assistant" && !item.time.completed)
        if (!current?.retry) return result([...source])
        return updateAssistant(source, current.id, sessionID, (item) => ({ ...item, retry: undefined }))
      }
      case "session.compaction.started":
        return append({
          id: event.data.inputID ?? messageID(event.id),
          type: "compaction",
          status: "running",
          metadata: event.metadata,
          reason: event.data.reason,
          summary: "",
          recent: event.data.recent,
          time: { created: event.created },
        })
      case "session.compaction.delta":
        return updateMessage<Extract<Compaction, { status: "running" }>>(source, (item): item is Extract<Compaction, { status: "running" }> => item.type === "compaction" && item.status === "running", (item) => ({
          ...item,
          summary: item.summary + event.data.text,
        }), sessionID)
      case "session.compaction.ended": {
        const current = source.findLast((item): item is Extract<Compaction, { status: "running" }> => item.type === "compaction" && item.status === "running")
        if (!current)
          return append({
            id: messageID(event.id),
            type: "compaction",
            status: "completed",
            metadata: event.metadata,
            reason: event.data.reason,
            summary: event.data.text,
            recent: event.data.recent,
            time: { created: event.created },
          })
        return result(update(source, current.id, () => ({
          ...current,
          status: "completed",
          reason: event.data.reason,
          summary: event.data.text,
          recent: event.data.recent,
        })), [current.id])
      }
      case "session.compaction.failed": {
        const current = source.findLast((item): item is Extract<Compaction, { status: "running" }> => item.type === "compaction" && item.status === "running")
        const failed: Extract<Compaction, { status: "failed" }> = {
          id: current?.id ?? event.data.inputID ?? messageID(event.id),
          type: "compaction",
          status: "failed",
          metadata: current?.metadata ?? event.metadata,
          reason: event.data.reason,
          error: event.data.error,
          time: current?.time ?? { created: event.created },
        }
        if (!current) return append(failed)
        return result(update(source, current.id, () => failed), [failed.id])
      }
      default:
        return
    }
  }

  return {
    reduce,
    clear(sessionID: string) {
      for (const id of pending.keys()) {
        if (id.startsWith(`${sessionID}:`)) pending.delete(id)
      }
    },
  }
}

function key(sessionID: string, inputID: string) {
  return `${sessionID}:${inputID}`
}

function messageID(eventID: string) {
  return eventID.replace(/^evt_/, "msg_")
}

function update(
  source: readonly SessionMessageInfo[],
  id: string,
  apply: (item: SessionMessageInfo) => SessionMessageInfo,
) {
  return source.map((item) => item.id === id ? apply(item) : item)
}

function updateMessage<T extends SessionMessageInfo>(
  source: readonly SessionMessageInfo[],
  matches: (item: SessionMessageInfo) => item is T,
  apply: (item: T) => T,
  sessionID: string,
): V2SessionReduction {
  const current = source.findLast(matches)
  if (!current) return { sessionID, messages: [...source], touched: [] }
  return { sessionID, messages: update(source, current.id, (item) => matches(item) ? apply(item) : item), touched: [current.id] }
}

function updateAssistant(
  source: readonly SessionMessageInfo[],
  id: string,
  sessionID: string,
  apply: (item: Assistant) => Assistant,
): V2SessionReduction {
  return {
    sessionID,
    messages: update(source, id, (item) => item.type === "assistant" ? apply(item) : item),
    touched: source.some((item) => item.id === id && item.type === "assistant") ? [id] : [],
  }
}

function updateContent<T extends "text" | "reasoning">(
  source: readonly SessionMessageInfo[],
  messageID: string,
  sessionID: string,
  type: T,
  ordinal: number,
  apply: (item: Extract<Assistant["content"][number], { type: T }>) => Extract<Assistant["content"][number], { type: T }>,
) {
  return updateAssistant(source, messageID, sessionID, (assistant) => {
    let index = -1
    return {
      ...assistant,
      content: assistant.content.map((item) => {
        if (item.type !== type || ++index !== ordinal) return item
        return apply(item as Extract<Assistant["content"][number], { type: T }>)
      }),
    }
  })
}

function updateTool(
  source: readonly SessionMessageInfo[],
  messageID: string,
  callID: string,
  sessionID: string,
  apply: (item: Extract<Assistant["content"][number], { type: "tool" }>) => Extract<Assistant["content"][number], { type: "tool" }>,
) {
  return updateAssistant(source, messageID, sessionID, (assistant) => ({
    ...assistant,
    content: assistant.content.map((item) => item.type === "tool" && item.id === callID ? apply(item) : item),
  }))
}

function insertOrdinal<T extends Assistant["content"][number]["type"]>(
  source: Assistant["content"],
  type: T,
  ordinal: number,
  item: Extract<Assistant["content"][number], { type: T }>,
) {
  const matches = source.filter((content) => content.type === type)
  if (matches[ordinal]) return source
  return [...source, item]
}

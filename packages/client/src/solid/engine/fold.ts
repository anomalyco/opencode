import type {
  SessionEventDurable,
  SessionInboxInfo,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  TokenUsageInfo,
} from "../../promise"

export type SessionFoldState = {
  readonly session: SessionInfo
  readonly children: ReadonlyArray<SessionInfo>
  readonly inbox: ReadonlyArray<SessionInboxInfo>
  readonly messages: ReadonlyArray<SessionMessageInfo>
  readonly active: "idle" | "running"
  readonly deleted: boolean
  readonly seq: number
}

export type SessionSnapshot = Omit<SessionFoldState, "active" | "deleted"> & {
  readonly active?: SessionFoldState["active"]
}

export type DurableSessionEvent = Exclude<SessionEventDurable, { readonly type: "session.forked" }>

export function fromSnapshot(snapshot: SessionSnapshot): SessionFoldState {
  return { ...snapshot, active: snapshot.active ?? "idle", deleted: false }
}

export function apply(state: SessionFoldState, event: DurableSessionEvent): SessionFoldState {
  if (event.durable.seq <= state.seq) return state
  const current = { ...state, seq: event.durable.seq }
  switch (event.type) {
    case "session.created":
      return current
    case "session.deleted":
      return { ...current, deleted: true }
    case "session.usage.recorded":
      return { ...current, session: addUsage(state.session, event.data.cost, event.data.tokens, event.created) }
    case "session.agent.selected":
      return append(
        {
          ...current,
          session: {
            ...state.session,
            agent: event.data.agent,
            time: { ...state.session.time, updated: event.created },
          },
        },
        {
          id: messageID(event.id),
          type: "agent-switched",
          agent: event.data.agent,
          previous: event.data.previous ?? state.session.agent,
          metadata: event.metadata,
          time: { created: event.created },
        },
      )
    case "session.model.selected":
      return append(
        {
          ...current,
          session: {
            ...state.session,
            model: event.data.model,
            time: { ...state.session.time, updated: event.created },
          },
        },
        {
          id: messageID(event.id),
          type: "model-switched",
          model: event.data.model,
          previous: event.data.previous ?? state.session.model,
          metadata: event.metadata,
          time: { created: event.created },
        },
      )
    case "session.moved":
      return append(
        {
          ...current,
          session: {
            ...state.session,
            location: event.data.location,
            projectID: event.data.projectID,
            subpath: event.data.subpath,
            time: { ...state.session.time, updated: event.created },
          },
        },
        {
          id: messageID(event.id),
          type: "location-switched",
          location: event.data.location,
          projectID: event.data.projectID,
          subpath: event.data.subpath,
          previous: {
            location: state.session.location,
            projectID: state.session.projectID,
            subpath: state.session.subpath,
          },
          metadata: event.metadata,
          time: { created: event.created },
        },
      )
    case "session.renamed":
      return {
        ...current,
        session: { ...state.session, title: event.data.title, time: { ...state.session.time, updated: event.created } },
      }
    case "session.inbox.enqueued":
      return {
        ...current,
        session: { ...state.session, time: { ...state.session.time, updated: event.created } },
        inbox: state.inbox.some((item) => item.id === event.data.inboxID)
          ? state.inbox
          : [
              ...state.inbox,
              {
                id: event.data.inboxID,
                sessionID: event.data.sessionID,
                timeCreated: event.created,
                ...event.data.item,
              },
            ],
      }
    case "session.inbox.delivered": {
      const item = state.inbox.find((item) => item.id === event.data.inboxID)
      const next = { ...current, inbox: state.inbox.filter((item) => item.id !== event.data.inboxID) }
      if (!item) return next
      const delivered = messageFromInbox(item, event.created)
      return delivered ? append(next, delivered) : next
    }
    case "session.inbox.cancelled":
      return { ...current, inbox: state.inbox.filter((item) => item.id !== event.data.inboxID) }
    case "session.inbox.delivery.changed":
      return {
        ...current,
        inbox: state.inbox.map((item) =>
          item.id === event.data.inboxID ? { ...item, delivery: event.data.delivery } : item,
        ),
      }
    case "session.execution.started":
      return { ...current, active: "running" }
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
      return { ...updateActiveAssistant(current, (message) => ({ ...message, retry: undefined })), active: "idle" }
    case "session.instructions.updated":
      if (event.data.text === undefined) return current
      return append(current, {
        id: messageID(event.id),
        type: "system",
        text: event.data.text,
        description: `Instructions updated: ${Object.keys(event.data.delta).join(", ")}`,
        metadata: event.metadata,
        time: { created: event.created },
      })
    case "session.synthetic":
      return append(current, {
        id: messageID(event.id),
        type: "synthetic",
        text: event.data.text,
        description: event.data.description,
        metadata: event.data.metadata,
        time: { created: event.created },
      })
    case "session.skill.activated":
      return append(current, {
        id: messageID(event.id),
        type: "skill",
        skill: event.data.id,
        name: event.data.name,
        text: event.data.text,
        metadata: event.metadata,
        time: { created: event.created },
      })
    case "session.shell.started":
      return append(current, {
        id: messageID(event.id),
        type: "shell",
        shellID: event.data.shell.id,
        command: event.data.shell.command,
        status: event.data.shell.status,
        metadata: event.metadata,
        time: { created: event.created },
      })
    case "session.shell.ended":
      return updateMessage(
        current,
        (message) => message.type === "shell" && message.shellID === event.data.shell.id,
        (message) => {
          if (message.type !== "shell") return message
          return {
            ...message,
            status: event.data.shell.status,
            exit: event.data.shell.exit,
            output: event.data.output,
            time: { ...message.time, completed: event.created },
          }
        },
        true,
      )
    case "session.step.started": {
      const existing = state.messages.some((message) => message.id === event.data.assistantMessageID)
      if (existing)
        return updateAssistant(current, event.data.assistantMessageID, (message) => ({
          ...message,
          agent: event.data.agent,
          model: event.data.model,
          retry: undefined,
          error: undefined,
          finish: undefined,
          time: { ...message.time, completed: undefined },
          snapshot: event.data.snapshot ? { ...message.snapshot, start: event.data.snapshot } : message.snapshot,
        }))
      return append(
        updateActiveAssistant(current, (message) => ({
          ...message,
          retry: undefined,
          time: { ...message.time, completed: event.created },
        })),
        {
          id: event.data.assistantMessageID,
          type: "assistant",
          agent: event.data.agent,
          model: event.data.model,
          metadata: event.metadata,
          content: [],
          snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
          time: { created: event.created },
        },
      )
    }
    case "session.step.ended":
      return withUsage(
        updateAssistant(current, event.data.assistantMessageID, (message) => ({
          ...message,
          finish: event.data.finish,
          cost: event.data.cost,
          tokens: event.data.tokens,
          time: { ...message.time, completed: event.created },
          snapshot:
            event.data.snapshot || event.data.files
              ? { ...message.snapshot, end: event.data.snapshot, files: event.data.files }
              : message.snapshot,
        })),
        event.data.cost,
        event.data.tokens,
        event.created,
      )
    case "session.step.failed": {
      const failed = updateAssistant(current, event.data.assistantMessageID, (message) => ({
        ...message,
        finish: "error",
        error: event.data.error,
        retry: undefined,
        cost: event.data.cost ?? message.cost,
        tokens: event.data.tokens ?? message.tokens,
        time: { ...message.time, completed: event.created },
        snapshot:
          event.data.snapshot || event.data.files
            ? { ...message.snapshot, end: event.data.snapshot, files: event.data.files }
            : message.snapshot,
      }))
      if (event.data.cost === undefined || event.data.tokens === undefined) return failed
      return withUsage(failed, event.data.cost, event.data.tokens, event.created)
    }
    case "session.text.started":
      return updateAssistant(current, event.data.assistantMessageID, (message) => ({
        ...message,
        content: insertOrdinal(message.content, "text", event.data.ordinal, { type: "text", text: "" }),
      }))
    case "session.text.ended":
      return updateContent(current, event.data.assistantMessageID, "text", event.data.ordinal, (part) => ({
        ...part,
        text: event.data.text,
        state: event.data.state,
      }))
    case "session.reasoning.started":
      return updateAssistant(current, event.data.assistantMessageID, (message) => ({
        ...message,
        content: insertOrdinal(message.content, "reasoning", event.data.ordinal, {
          type: "reasoning",
          text: "",
          state: event.data.state,
          time: { created: event.created },
        }),
      }))
    case "session.reasoning.ended":
      return updateContent(current, event.data.assistantMessageID, "reasoning", event.data.ordinal, (part) => ({
        ...part,
        text: event.data.text,
        state: event.data.state ?? part.state,
        time: { created: part.time?.created ?? event.created, completed: event.created },
      }))
    case "session.tool.input.started":
      return updateAssistant(current, event.data.assistantMessageID, (message) => ({
        ...message,
        content: [
          ...message.content,
          {
            type: "tool",
            id: event.data.id,
            name: event.data.name,
            state: { status: "streaming", input: "" },
            time: { created: event.created },
          },
        ],
      }))
    case "session.tool.input.ended":
      return updateTool(current, event.data.assistantMessageID, event.data.id, (part) =>
        part.state.status === "streaming" ? { ...part, state: { ...part.state, input: event.data.text } } : part,
      )
    case "session.tool.called":
      return updateTool(current, event.data.assistantMessageID, event.data.id, (part) => ({
        ...part,
        executed: event.data.executed,
        providerState: event.data.state,
        state: { status: "running", input: event.data.input, metadata: {} },
        time: { ...part.time, ran: event.created },
      }))
    case "session.tool.success":
      return updateTool(current, event.data.assistantMessageID, event.data.id, (part) => {
        if (part.state.status !== "running") return part
        return {
          ...part,
          executed: event.data.executed || part.executed === true,
          providerResultState: event.data.resultState,
          state: {
            status: "completed",
            input: part.state.input,
            content: event.data.content,
            metadata: event.data.metadata,
          },
          time: { ...part.time, completed: event.created },
        }
      })
    case "session.tool.failed":
      return updateTool(current, event.data.assistantMessageID, event.data.id, (part) => {
        if (part.state.status !== "streaming" && part.state.status !== "running") return part
        return {
          ...part,
          executed: event.data.executed || part.executed === true,
          providerResultState: event.data.resultState,
          state: {
            status: "error",
            error: event.data.error,
            input: typeof part.state.input === "string" ? {} : part.state.input,
            content: event.data.content,
            metadata: event.data.metadata,
          },
          time: { ...part.time, completed: event.created },
        }
      })
    case "session.retry.scheduled":
      return updateAssistant(current, event.data.assistantMessageID, (message) => ({
        ...message,
        retry: { attempt: event.data.attempt, at: event.data.at, error: event.data.error },
      }))
    case "session.compaction.started":
      return append(
        {
          ...current,
          inbox: event.data.inputID ? state.inbox.filter((item) => item.id !== event.data.inputID) : state.inbox,
        },
        {
          id: event.data.inputID ?? messageID(event.id),
          type: "compaction",
          status: "running",
          reason: event.data.reason,
          summary: "",
          recent: event.data.recent,
          metadata: event.metadata,
          time: { created: event.created },
        },
      )
    case "session.compaction.ended": {
      const running = state.messages.findLast(
        (message) => message.type === "compaction" && message.status === "running",
      )
      if (!running)
        return append(current, {
          id: messageID(event.id),
          type: "compaction",
          status: "completed",
          reason: event.data.reason,
          summary: event.data.text,
          recent: event.data.recent,
          metadata: event.metadata,
          time: { created: event.created },
        })
      return updateMessage(
        current,
        (message) => message.id === running.id,
        (message) => ({
          ...message,
          type: "compaction",
          status: "completed",
          reason: event.data.reason,
          summary: event.data.text,
          recent: event.data.recent,
        }),
      )
    }
    case "session.compaction.failed": {
      const running = state.messages.findLast(
        (message) => message.type === "compaction" && message.status === "running",
      )
      const failed = {
        id: running?.id ?? event.data.inputID ?? messageID(event.id),
        type: "compaction" as const,
        status: "failed" as const,
        reason: event.data.reason,
        error: event.data.error,
        metadata: running?.metadata ?? event.metadata,
        time: running?.time ?? { created: event.created },
      }
      const next = {
        ...current,
        inbox: event.data.inputID ? state.inbox.filter((item) => item.id !== event.data.inputID) : state.inbox,
      }
      return running
        ? updateMessage(
            next,
            (message) => message.id === running.id,
            () => failed,
          )
        : append(next, failed)
    }
    case "session.revert.staged":
      return {
        ...current,
        session: {
          ...state.session,
          revert: event.data.revert,
          time: { ...state.session.time, updated: event.created },
        },
      }
    case "session.revert.cleared":
      return {
        ...current,
        session: { ...state.session, revert: undefined, time: { ...state.session.time, updated: event.created } },
      }
    case "session.revert.committed":
      return {
        ...current,
        session: { ...state.session, revert: undefined, time: { ...state.session.time, updated: event.created } },
        messages: state.messages.filter((message) => message.id < event.data.to),
        inbox: state.inbox.filter((item) => item.id < event.data.to),
      }
  }
}

function messageID(eventID: string) {
  return eventID.replace(/^evt_/, "msg_")
}

export function messageFromInbox(item: SessionInboxInfo, created = item.timeCreated): SessionMessageInfo | undefined {
  if (item.type === "user") return { id: item.id, type: "user", ...item.payload, time: { created } }
  if (item.type === "synthetic") return { id: item.id, type: "synthetic", ...item.payload, time: { created } }
}

function append(state: SessionFoldState, item: SessionMessageInfo) {
  if (state.messages.some((message) => message.id === item.id)) return state
  return { ...state, messages: [...state.messages, item] }
}

function updateMessage(
  state: SessionFoldState,
  predicate: (message: SessionMessageInfo) => boolean,
  update: (message: SessionMessageInfo) => SessionMessageInfo,
  last = false,
) {
  const index = last ? state.messages.findLastIndex(predicate) : state.messages.findIndex(predicate)
  if (index < 0) return state
  return {
    ...state,
    messages: state.messages.map((message, position) => (position === index ? update(message) : message)),
  }
}

function updateAssistant(
  state: SessionFoldState,
  messageID: string,
  update: (message: SessionMessageAssistant) => SessionMessageAssistant,
) {
  return updateMessage(
    state,
    (message) => message.id === messageID && message.type === "assistant",
    (message) => (message.type === "assistant" ? update(message) : message),
  )
}

function updateActiveAssistant(
  state: SessionFoldState,
  update: (message: SessionMessageAssistant) => SessionMessageAssistant,
) {
  return updateMessage(
    state,
    (message) => message.type === "assistant" && message.time.completed === undefined,
    (message) => (message.type === "assistant" ? update(message) : message),
    true,
  )
}

function updateContent<Type extends "text" | "reasoning">(
  state: SessionFoldState,
  messageID: string,
  type: Type,
  ordinal: number,
  update: (
    part: Extract<SessionMessageAssistant["content"][number], { readonly type: Type }>,
  ) => Extract<SessionMessageAssistant["content"][number], { readonly type: Type }>,
) {
  return updateAssistant(state, messageID, (message) => {
    const position = message.content.flatMap((part, index) => (part.type === type ? [index] : []))[ordinal]
    const part = position === undefined ? undefined : message.content[position]
    if (!part || part.type !== type) return message
    return {
      ...message,
      content: message.content.map((item, index) =>
        index === position
          ? update(part as Extract<SessionMessageAssistant["content"][number], { readonly type: Type }>)
          : item,
      ),
    }
  })
}

function updateTool(
  state: SessionFoldState,
  messageID: string,
  toolID: string,
  update: (part: SessionMessageAssistantTool) => SessionMessageAssistantTool,
) {
  return updateAssistant(state, messageID, (message) => {
    const index = message.content.findLastIndex((part) => part.type === "tool" && part.id === toolID)
    if (index < 0) return message
    return {
      ...message,
      content: message.content.map((part, position) =>
        position === index && part.type === "tool" ? update(part) : part,
      ),
    }
  })
}

function insertOrdinal<Type extends SessionMessageAssistant["content"][number]["type"]>(
  content: SessionMessageAssistant["content"],
  type: Type,
  ordinal: number,
  part: Extract<SessionMessageAssistant["content"][number], { readonly type: Type }>,
) {
  if (content.filter((item) => item.type === type)[ordinal]) return content
  return [...content, part]
}

function addUsage(session: SessionInfo, cost: number, tokens: TokenUsageInfo, updated: number): SessionInfo {
  return {
    ...session,
    cost: session.cost + cost,
    tokens: {
      input: session.tokens.input + tokens.input,
      output: session.tokens.output + tokens.output,
      reasoning: session.tokens.reasoning + tokens.reasoning,
      cache: {
        read: session.tokens.cache.read + tokens.cache.read,
        write: session.tokens.cache.write + tokens.cache.write,
      },
    },
    time: { ...session.time, updated },
  }
}

function withUsage(state: SessionFoldState, cost: number, tokens: TokenUsageInfo, updated: number) {
  return { ...state, session: addUsage(state.session, cost, tokens, updated) }
}

export * as SessionFold from "./fold"

// Current-native subagent (child Session) tracking for the mini transport.
//
// Discovers child Sessions of the active parent from four current sources:
//   1. projected subagent tool output (`structured.sessionID`) during hydration
//   2. the current session list filtered by `parentID` during hydration
//   3. the process-local active-session map during hydration
//   4. live events from unknown sessions whose `parentID` matches the parent
//
// Tracks one footer tab per child and a detail transcript for the selected
// child, reduced from the same current live event stream the parent uses.
// Detail transcripts rebuild from projected messages on discovery, selection,
// and reconnect, then continue from live deltas using the same
// projected-prefix dedup the parent transport uses.
//
// Per-child interruption uses `v2.session.interrupt(childID)`. Per-child
// backgrounding is intentionally absent: subagent jobs block the parent
// session, so only whole-session `v2.session.background(parentID)` exists.
import type {
  EventSubscribeOutput,
  OpenCodeClient,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode-ai/client/promise"
import { Locale } from "@opencode-ai/tui/util/locale"
import type { FooterSubagentDetail, FooterSubagentState, FooterSubagentTab, MiniToolPart, StreamCommit } from "./types"

const CHILD_MESSAGE_LIMIT = 80
const CHILD_FRAME_LIMIT = 80
const CHILD_EVENT_BUFFER_LIMIT = 64
const FAMILY_LIST_LIMIT = 100
const FALLBACK_LABEL = "Subagent"

type V2Event = EventSubscribeOutput

export function outputText(content: ReadonlyArray<{ type: string; text?: string }>) {
  return content.flatMap((item) => (item.type === "text" && item.text ? [item.text] : [])).join("\n")
}

export function miniTool(input: {
  sessionID: string
  messageID: string
  tool: SessionMessageAssistantTool
}): MiniToolPart {
  const tool = input.tool
  const providerCall =
    tool.executed === undefined && tool.providerState === undefined
      ? undefined
      : { executed: tool.executed, state: tool.providerState }
  const providerResult =
    tool.executed === undefined && tool.providerResultState === undefined
      ? undefined
      : { executed: tool.executed, state: tool.providerResultState }
  const base = {
    id: `prt_${tool.id}`,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "tool" as const,
    callID: tool.id,
    tool: tool.name,
  }
  if (tool.state.status === "streaming") {
    return {
      ...base,
      state: { status: "pending", input: {}, raw: tool.state.input },
    }
  }
  if (tool.state.status === "running") {
    return {
      ...base,
      state: {
        status: "running",
        input: tool.state.input,
        title: tool.name,
        metadata: { structured: tool.state.structured, content: tool.state.content, providerCall },
        time: { start: tool.time.ran ?? tool.time.created },
      },
    }
  }
  if (tool.state.status === "completed") {
    return {
      ...base,
      state: {
        status: "completed",
        input: tool.state.input,
        output: outputText(tool.state.content),
        title: tool.name,
        metadata: {
          structured: tool.state.structured,
          content: tool.state.content,
          result: tool.state.result,
          providerCall,
          providerResult,
        },
        time: { start: tool.time.ran ?? tool.time.created, end: tool.time.completed ?? tool.time.created },
      },
    }
  }
  return {
    ...base,
    state: {
      status: "error",
      input: tool.state.input,
      error: tool.state.error.message,
      metadata: {
        structured: tool.state.structured,
        content: tool.state.content,
        result: tool.state.result,
        providerCall,
        providerResult,
      },
      time: { start: tool.time.ran ?? tool.time.created, end: tool.time.completed ?? tool.time.created },
    },
  }
}

export function toolCommit(part: MiniToolPart, phase: "start" | "progress" | "final"): StreamCommit {
  const status = part.state.status
  const text =
    status === "running"
      ? part.tool === "task"
        ? "running task"
        : `running ${part.tool}`
      : status === "completed"
        ? part.state.output
        : status === "error"
          ? part.state.error
          : ""
  return {
    kind: "tool",
    source: "tool",
    text,
    phase,
    messageID: part.messageID,
    partID: part.id,
    tool: part.tool,
    part,
    toolState: status === "error" ? "error" : status === "completed" ? "completed" : "running",
    toolError: status === "error" ? part.state.error : undefined,
  }
}

type Frame = {
  key: string
  commit: StreamCommit
}

type ToolTrack = {
  name: string
  input: Record<string, unknown>
  started: number
  providerState?: Record<string, unknown>
}

type ChildState = {
  sessionID: string
  label: string
  description: string
  status: FooterSubagentTab["status"]
  background: boolean
  title?: string
  callIDs: Set<string>
  lastUpdatedAt: number
  frames: Frame[]
  text: Map<string, string>
  projectedText: Map<string, string>
  reasoning: Map<string, string>
  projectedReasoning: Map<string, string>
  tools: Map<string, ToolTrack>
  finishedTools: Set<string>
  messageIDs: Set<string>
  prompts: Map<string, string>
  hydrated: boolean
}

export type SubagentTrackerInput = {
  sdk: OpenCodeClient
  sessionID: string
  thinking: boolean
  emit: () => void
}

export type SubagentTracker = {
  main(event: V2Event): void
  foreign(sessionID: string, event: V2Event): void
  hydrate(next: { messages: SessionMessageInfo[]; active: Record<string, unknown> }): Promise<void>
  select(sessionID: string | undefined): void
  snapshot(): FooterSubagentState
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  return undefined
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const next = value.trim()
  return next || undefined
}

function childSessionID(structured: Record<string, unknown> | undefined) {
  const sessionID = text(structured?.sessionID)
  if (!sessionID || !sessionID.startsWith("ses")) return undefined
  const status = structured?.status
  if (status !== "running" && status !== "completed") return undefined
  return { sessionID, running: status === "running" }
}

function tab(child: ChildState): FooterSubagentTab {
  return {
    sessionID: child.sessionID,
    partID: `subagent:${child.sessionID}`,
    callID: `subagent:${child.sessionID}`,
    label: child.label,
    description: child.description || child.title || "",
    status: child.status,
    background: child.background ? true : undefined,
    title: child.title,
    toolCalls: child.callIDs.size > 0 ? child.callIDs.size : undefined,
    lastUpdatedAt: child.lastUpdatedAt,
  }
}

export function createSubagentTracker(input: SubagentTrackerInput): SubagentTracker {
  const children = new Map<string, ChildState>()
  // Live subagent tool calls in the parent, so tool.success structured output
  // can be joined with the call's input metadata.
  const pendingCalls = new Map<string, Record<string, unknown>>()
  // Foreign sessions already resolved through session.get. Non-children stay
  // cached so unrelated concurrent sessions are checked at most once.
  const checked = new Set<string>()
  // Foreign events buffered while a session.get discovery is in flight, so a
  // fast child (including its settled event) is not lost mid-discovery.
  const pendingEvents = new Map<string, V2Event[]>()
  const hydrationEvents = new Map<string, V2Event[]>()
  const hydrationOverflow = new Set<string>()
  const hydrations = new Map<string, Promise<void>>()
  let selected: string | undefined
  const fragmentKey = (messageID: string, partID: string) => `${messageID}\u0000${partID}`

  const ensureChild = (sessionID: string): ChildState => {
    const existing = children.get(sessionID)
    const child: ChildState = existing ?? {
      sessionID,
      label: FALLBACK_LABEL,
      description: "",
      status: "running",
      background: false,
      callIDs: new Set(),
      lastUpdatedAt: Date.now(),
      frames: [],
      text: new Map(),
      projectedText: new Map(),
      reasoning: new Map(),
      projectedReasoning: new Map(),
      tools: new Map(),
      finishedTools: new Set(),
      messageIDs: new Set(),
      prompts: new Map(),
      hydrated: false,
    }
    if (!existing) children.set(sessionID, child)
    // Adopting a child while its session.get discovery is still in flight:
    // drain the buffered events now. They arrived before whatever the caller
    // applies next, so replaying them first preserves bus order, and the
    // resolved discovery can no longer replay stale events (e.g. step.started)
    // after a terminal settled event was applied directly.
    const buffered = pendingEvents.get(sessionID)
    if (buffered) {
      pendingEvents.delete(sessionID)
      for (const event of buffered) reduce(child, event)
    }
    return child
  }

  const touch = (child: ChildState, timestamp?: number) => {
    child.lastUpdatedAt = Math.max(child.lastUpdatedAt, timestamp ?? Date.now())
  }

  const notifyDetail = (child: ChildState) => {
    if (child.sessionID === selected) input.emit()
  }

  const setFrame = (child: ChildState, key: string, commit: StreamCommit) => {
    const index = child.frames.findIndex((item) => item.key === key)
    if (index === -1) {
      child.frames.push({ key, commit })
      if (child.frames.length > CHILD_FRAME_LIMIT) child.frames.splice(0, child.frames.length - CHILD_FRAME_LIMIT)
      return
    }
    child.frames[index] = { key, commit }
  }

  const applyMeta = (child: ChildState, meta: Record<string, unknown> | undefined) => {
    if (!meta) return
    const agent = text(meta.agent)
    if (agent) child.label = Locale.titlecase(agent)
    const description = text(meta.description)
    if (description) child.description = description
    if (meta.background === true) child.background = true
  }

  const userFrame = (child: ChildState, messageID: string, value: string) => {
    if (child.messageIDs.has(messageID)) return false
    child.messageIDs.add(messageID)
    setFrame(child, `user:${messageID}`, {
      kind: "user",
      source: "system",
      text: value,
      phase: "start",
      messageID,
    })
    return true
  }

  const childTool = (child: ChildState, item: SessionMessageAssistantTool, messageID: string) => {
    const part = miniTool({
      sessionID: child.sessionID,
      messageID,
      tool: item,
    })
    if (item.state.status === "streaming") return
    child.callIDs.add(item.id)
    if (item.state.status === "running") {
      setFrame(child, `tool:${item.id}`, toolCommit(part, "start"))
      return
    }
    child.finishedTools.add(item.id)
    child.tools.delete(item.id)
    setFrame(child, `tool:${item.id}`, toolCommit(part, "final"))
  }

  const rebuild = (child: ChildState, messages: SessionMessageInfo[]) => {
    child.frames = []
    child.text.clear()
    child.projectedText.clear()
    child.reasoning.clear()
    child.projectedReasoning.clear()
    child.finishedTools.clear()
    child.messageIDs.clear()
    child.callIDs.clear()
    for (const message of messages) {
      if (message.type === "user") {
        child.prompts.delete(message.id)
        userFrame(child, message.id, message.text)
        continue
      }
      if (message.type !== "assistant") continue
      child.messageIDs.add(message.id)
      let textOrdinal = 0
      let reasoningOrdinal = 0
      for (const item of message.content) {
        if (item.type === "text") {
          const id = `text:${textOrdinal++}`
          const key = fragmentKey(message.id, id)
          child.text.set(key, item.text)
          child.projectedText.set(key, item.text)
          setFrame(child, key, {
            kind: "assistant",
            source: "assistant",
            text: item.text,
            phase: "progress",
            messageID: message.id,
            partID: id,
          })
          continue
        }
        if (item.type === "reasoning") {
          const id = `reasoning:${reasoningOrdinal++}`
          const key = fragmentKey(message.id, id)
          child.reasoning.set(key, item.text)
          child.projectedReasoning.set(key, item.text)
          if (input.thinking)
            setFrame(child, key, {
              kind: "reasoning",
              source: "reasoning",
              text: `Thinking: ${item.text}`,
              phase: "progress",
              messageID: message.id,
              partID: id,
            })
          continue
        }
        childTool(child, item, message.id)
      }
      if (message.error) {
        setFrame(child, `error:${message.id}`, {
          kind: "error",
          source: "system",
          text: message.error.message,
          phase: "start",
          messageID: message.id,
        })
      }
    }
  }

  const hydrateChild = (child: ChildState): Promise<void> => {
    const existing = hydrations.get(child.sessionID)
    if (existing) return existing
    const pendingPrompts = new Map(child.prompts)
    const pendingTools = new Map(child.tools)
    let retry = false
    const task = input.sdk.message
      .list({ sessionID: child.sessionID, limit: CHILD_MESSAGE_LIMIT, order: "desc" })
      .then((response) => {
        const buffered = hydrationEvents.get(child.sessionID) ?? []
        hydrationEvents.delete(child.sessionID)
        if (hydrationOverflow.delete(child.sessionID)) {
          child.hydrated = false
          retry = true
          notifyDetail(child)
          return
        }
        for (const [id, prompt] of pendingPrompts) {
          if (!child.prompts.has(id)) child.prompts.set(id, prompt)
        }
        rebuild(child, structuredClone(response.data).toReversed() as SessionMessageInfo[])
        for (const [id, tool] of pendingTools) {
          if (!child.finishedTools.has(id) && !child.tools.has(id)) child.tools.set(id, tool)
        }
        for (const event of buffered) reduce(child, event)
        child.hydrated = true
        notifyDetail(child)
      })
      .catch(() => {
        hydrationEvents.delete(child.sessionID)
        hydrationOverflow.delete(child.sessionID)
      })
      .finally(() => {
        hydrations.delete(child.sessionID)
        if (retry) queueMicrotask(() => void hydrateChild(child))
      })
    hydrations.set(child.sessionID, task)
    return task
  }

  const discover = (sessionID: string) => {
    if (checked.has(sessionID) || children.has(sessionID) || sessionID === input.sessionID) return
    checked.add(sessionID)
    if (!pendingEvents.has(sessionID)) pendingEvents.set(sessionID, [])
    void input.sdk.session
      .get({ sessionID })
      .then((session) => {
        const buffered = pendingEvents.get(sessionID) ?? []
        pendingEvents.delete(sessionID)
        if (session.parentID !== input.sessionID) return
        const child = ensureChild(sessionID)
        if (session.agent) child.label = Locale.titlecase(session.agent)
        child.title = session.title
        for (const event of buffered) reduce(child, event)
        touch(child)
        input.emit()
        void hydrateChild(child)
      })
      .catch(() => {
        // Allow a later event to retry discovery after transient failures.
        pendingEvents.delete(sessionID)
        checked.delete(sessionID)
      })
  }

  const reduce = (child: ChildState, event: V2Event) => {
    if (event.type === "session.input.admitted") {
      if (event.data.input.type === "user") child.prompts.set(event.data.inputID, event.data.input.data.text)
      return
    }
    if (event.type === "session.input.promoted") {
      const prompt = child.prompts.get(event.data.inputID)
      if (prompt === undefined) return
      child.prompts.delete(event.data.inputID)
      if (userFrame(child, event.data.inputID, prompt)) {
        touch(child, event.created)
        notifyDetail(child)
      }
      return
    }
    if (event.type === "session.step.started") {
      touch(child, event.created)
      if (child.label === FALLBACK_LABEL && event.data.agent) child.label = Locale.titlecase(event.data.agent)
      if (child.status !== "running") child.status = "running"
      input.emit()
      return
    }
    if (event.type === "session.text.started") {
      return
    }
    if (event.type === "session.text.delta") {
      const id = `text:${event.data.ordinal}`
      const key = fragmentKey(event.data.assistantMessageID, id)
      const projected = child.projectedText.get(key)
      const covered = projected?.indexOf(event.data.delta) ?? -1
      if (projected && covered >= 0) {
        child.projectedText.set(key, projected.slice(covered + event.data.delta.length))
        return
      }
      const next = (child.text.get(key) ?? "") + event.data.delta
      child.text.set(key, next)
      setFrame(child, key, {
        kind: "assistant",
        source: "assistant",
        text: next,
        phase: "progress",
        messageID: event.data.assistantMessageID,
        partID: id,
      })
      touch(child, event.created)
      notifyDetail(child)
      return
    }
    if (event.type === "session.text.ended") {
      const id = `text:${event.data.ordinal}`
      const key = fragmentKey(event.data.assistantMessageID, id)
      child.text.set(key, event.data.text)
      child.projectedText.delete(key)
      setFrame(child, key, {
        kind: "assistant",
        source: "assistant",
        text: event.data.text,
        phase: "progress",
        messageID: event.data.assistantMessageID,
        partID: id,
      })
      touch(child, event.created)
      notifyDetail(child)
      return
    }
    if (event.type === "session.reasoning.started") {
      return
    }
    if (event.type === "session.reasoning.delta") {
      const id = `reasoning:${event.data.ordinal}`
      const key = fragmentKey(event.data.assistantMessageID, id)
      const projected = child.projectedReasoning.get(key)
      const covered = projected?.indexOf(event.data.delta) ?? -1
      if (projected && covered >= 0) {
        child.projectedReasoning.set(key, projected.slice(covered + event.data.delta.length))
        return
      }
      const next = (child.reasoning.get(key) ?? "") + event.data.delta
      child.reasoning.set(key, next)
      if (!input.thinking) return
      setFrame(child, key, {
        kind: "reasoning",
        source: "reasoning",
        text: `Thinking: ${next}`,
        phase: "progress",
        messageID: event.data.assistantMessageID,
        partID: id,
      })
      notifyDetail(child)
      return
    }
    if (event.type === "session.reasoning.ended") {
      const id = `reasoning:${event.data.ordinal}`
      const key = fragmentKey(event.data.assistantMessageID, id)
      child.reasoning.set(key, event.data.text)
      child.projectedReasoning.delete(key)
      if (!input.thinking) return
      setFrame(child, key, {
        kind: "reasoning",
        source: "reasoning",
        text: `Thinking: ${event.data.text}`,
        phase: "progress",
        messageID: event.data.assistantMessageID,
        partID: id,
      })
      notifyDetail(child)
      return
    }
    if (event.type === "session.tool.input.started") {
      if (child.finishedTools.has(event.data.callID)) return
      child.tools.set(event.data.callID, { name: event.data.name, input: {}, started: event.created })
      return
    }
    if (event.type === "session.tool.called") {
      if (child.finishedTools.has(event.data.callID)) return
      const current = child.tools.get(event.data.callID)
      child.tools.set(event.data.callID, {
        name: current?.name ?? "tool",
        input: event.data.input,
        started: current?.started ?? event.created,
        providerState: event.data.state,
      })
      childTool(
        child,
        structuredClone({
          type: "tool",
          id: event.data.callID,
          name: current?.name ?? "tool",
          executed: event.data.executed,
          providerState: event.data.state,
          state: { status: "running", input: event.data.input, structured: {}, content: [] },
          time: { created: current?.started ?? event.created, ran: event.created },
        }) as SessionMessageAssistantTool,
        event.data.assistantMessageID,
      )
      touch(child, event.created)
      notifyDetail(child)
      return
    }
    if (event.type === "session.tool.success" || event.type === "session.tool.failed") {
      if (child.finishedTools.has(event.data.callID)) return
      const current = child.tools.get(event.data.callID)
      const failed = event.type === "session.tool.failed"
      childTool(
        child,
        structuredClone({
          type: "tool",
          id: event.data.callID,
          name: current?.name ?? "tool",
          executed: event.data.executed,
          providerState: current?.providerState,
          providerResultState: event.data.resultState,
          state: failed
            ? {
                status: "error",
                input: current?.input ?? {},
                structured: {},
                content: [],
                error: event.data.error,
                result: event.data.result,
              }
            : {
                status: "completed",
                input: current?.input ?? {},
                structured: event.data.structured,
                content: event.data.content,
                result: event.data.result,
              },
          time: {
            created: current?.started ?? event.created,
            ran: current?.started,
            completed: event.created,
          },
        }) as SessionMessageAssistantTool,
        event.data.assistantMessageID,
      )
      touch(child, event.created)
      notifyDetail(child)
      return
    }
    if (event.type === "session.step.ended") return
    if (event.type === "session.step.failed") {
      setFrame(child, `error:step:${event.data.assistantMessageID}`, {
        kind: "error",
        source: "system",
        text: event.data.error.message,
        phase: "start",
        messageID: event.data.assistantMessageID,
      })
      touch(child, event.created)
      notifyDetail(child)
      return
    }
    if (event.type === "session.execution.started") {
      child.status = "running"
      touch(child, event.created)
      input.emit()
      return
    }
    if (
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted"
    ) {
      child.status =
        event.type === "session.execution.succeeded"
          ? "completed"
          : event.type === "session.execution.interrupted"
            ? "cancelled"
            : "error"
      touch(child, event.created)
      input.emit()
    }
  }

  const mainTool = (item: SessionMessageAssistantTool, active?: Record<string, unknown>) => {
    if (item.name !== "subagent" || item.state.status !== "completed") return
    const found = childSessionID(record(item.state.structured))
    if (!found) return
    const child = ensureChild(found.sessionID)
    applyMeta(child, record(item.state.input))
    if (found.running) child.background = true
    if (child.status === "running") {
      const running = found.running && (!active || found.sessionID in active)
      child.status = running ? "running" : "completed"
    }
    touch(child, item.time.completed ?? item.time.created)
  }

  return {
    main(event) {
      if (event.type === "session.tool.input.started") {
        if (event.data.name === "subagent") pendingCalls.set(event.data.callID, {})
        return
      }
      if (event.type === "session.tool.called") {
        if (pendingCalls.has(event.data.callID)) pendingCalls.set(event.data.callID, event.data.input)
        return
      }
      if (event.type === "session.tool.failed") {
        pendingCalls.delete(event.data.callID)
        return
      }
      if (event.type !== "session.tool.success") return
      const pending = pendingCalls.get(event.data.callID)
      pendingCalls.delete(event.data.callID)
      const found = childSessionID(record(event.data.structured))
      if (!found) return
      const child = ensureChild(found.sessionID)
      applyMeta(child, pending)
      if (found.running) {
        child.background = true
        child.status = "running"
      }
      if (!found.running && child.status === "running") child.status = "completed"
      touch(child, event.created)
      input.emit()
      if (!child.hydrated) void hydrateChild(child)
    },
    foreign(sessionID, event) {
      const child = children.get(sessionID)
      if (child) {
        if (hydrations.has(sessionID)) {
          const buffered = hydrationEvents.get(sessionID) ?? []
          if (buffered.length < CHILD_EVENT_BUFFER_LIMIT) buffered.push(event)
          else hydrationOverflow.add(sessionID)
          hydrationEvents.set(sessionID, buffered)
        }
        reduce(child, event)
        return
      }
      discover(sessionID)
      const buffered = pendingEvents.get(sessionID)
      if (buffered && buffered.length < CHILD_EVENT_BUFFER_LIMIT) buffered.push(event)
    },
    async hydrate(next) {
      for (const message of next.messages) {
        if (message.type !== "assistant") continue
        for (const item of message.content) {
          if (item.type === "tool") mainTool(item, next.active)
        }
      }
      // Family index: adopt children directly from the current session list so
      // historical subagents beyond the projected message window still get tabs.
      const family = await input.sdk.session
        .list({ parentID: input.sessionID, limit: FAMILY_LIST_LIMIT, order: "desc" })
        .then((response) => response.data)
        .catch(() => [])
      for (const session of family) {
        const child = ensureChild(session.id)
        if (session.agent && child.label === FALLBACK_LABEL) child.label = Locale.titlecase(session.agent)
        if (!child.title) child.title = session.title
        touch(child, session.time.updated)
      }
      for (const sessionID of Object.keys(next.active)) discover(sessionID)
      for (const child of children.values()) {
        // Reconnect can miss a child's settled event; the active map is the
        // authoritative live signal for still-running children.
        if (child.status === "running" && !(child.sessionID in next.active)) child.status = "completed"
      }
      const current = selected ? children.get(selected) : undefined
      if (current) await hydrateChild(current)
      if (children.size > 0) input.emit()
    },
    select(sessionID) {
      selected = sessionID
      const child = sessionID ? children.get(sessionID) : undefined
      if (child && !child.hydrated) void hydrateChild(child)
      input.emit()
    },
    snapshot() {
      const tabs = [...children.values()].map(tab).toSorted((a, b) => {
        const active = Number(b.status === "running") - Number(a.status === "running")
        if (active !== 0) return active
        return b.lastUpdatedAt - a.lastUpdatedAt
      })
      const child = selected ? children.get(selected) : undefined
      const details: Record<string, FooterSubagentDetail> = child
        ? { [child.sessionID]: { sessionID: child.sessionID, commits: child.frames.map((item) => item.commit) } }
        : {}
      return { tabs, details, permissions: [], questions: [] }
    },
  }
}

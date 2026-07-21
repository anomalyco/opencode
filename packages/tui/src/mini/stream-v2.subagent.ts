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
  PermissionV2Request,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode-ai/client/promise"
import { Locale } from "../util/locale"
import { createFragmentReconciler, fragmentRef, type FragmentReconciler } from "./stream-v2.fragment"
import type {
  FooterSubagentDetail,
  FooterSubagentState,
  FooterSubagentTab,
  MiniFormRequest,
  MiniPermissionRequest,
  StreamCommit,
} from "./types"
import { canonicalToolName, normalizeTool, toolOutputText, toolView } from "./tool"

const CHILD_MESSAGE_LIMIT = 80
const CHILD_FRAME_LIMIT = 80
const CHILD_EVENT_BUFFER_LIMIT = 64
const FAMILY_LIST_LIMIT = 100
const FAMILY_DISCOVERY_CONCURRENCY = 8
const BLOCKER_RETRY_INITIAL_MS = 50
const BLOCKER_RETRY_MAX_MS = 2_000
const FALLBACK_LABEL = "Subagent"

type V2Event = EventSubscribeOutput

export function toolCommit(
  input: SessionMessageAssistantTool,
  messageID: string,
  phase: "start" | "progress" | "final",
  value?: string,
  directory?: string,
  version = 0,
): StreamCommit {
  const part = normalizeTool(input)
  const status = part.state.status
  const output = status === "streaming" ? "" : toolOutputText(part.name, part.state.content)
  const partial = status === "error" && phase === "progress" && value !== undefined
  const text =
    status === "running" || partial
      ? (value ?? (part.name === "subagent" ? "running subagent" : `running ${part.name}`))
      : status === "completed"
        ? (value ?? output)
        : status === "error"
          ? part.state.error.message
          : ""
  return {
    kind: "tool",
    source: "tool",
    text,
    phase,
    messageID,
    partID: `prt_${part.id}${version > 0 ? `:snapshot:${version}` : ""}`,
    tool: part.name,
    directory,
    part,
    toolState: status === "error" && !partial ? "error" : status === "completed" ? "completed" : "running",
    toolError: status === "error" && !partial ? part.state.error.message : undefined,
  }
}

export function toolFinalPhase(part: SessionMessageAssistantTool) {
  const tool = normalizeTool(part)
  if (tool.state.status !== "completed") return "final" as const
  return toolView(tool.name).output && toolOutputText(tool.name, tool.state.content)
    ? ("progress" as const)
    : ("final" as const)
}

type Frame = {
  key: string
  commit: StreamCommit
}

type ToolTrack = {
  part: SessionMessageAssistantTool
}

type ChildState = {
  sessionID: string
  label: string
  description: string
  status: FooterSubagentTab["status"]
  background: boolean
  title?: string
  lastUpdatedAt: number
  frames: Frame[]
  fragments: FragmentReconciler
  tools: Map<string, ToolTrack>
  toolSources: Map<string, SessionMessageAssistantTool>
  finishedTools: Set<string>
  permissions: MiniPermissionRequest[]
  forms: MiniFormRequest[]
  messageIDs: Set<string>
  prompts: Map<string, string>
  hydrated: boolean
  detailStale: boolean
  blockersHydrated: boolean
}

export type SubagentTrackerInput = {
  sessionID: string
  thinking: boolean
  directory?: string
  signal: AbortSignal
  emit: () => void
}

export type SubagentTracker = {
  main(sdk: OpenCodeClient, event: V2Event, signal?: AbortSignal): void
  foreign(sdk: OpenCodeClient, sessionID: string, event: V2Event, signal?: AbortSignal): void
  hydrate(next: {
    sdk: OpenCodeClient
    messages: SessionMessageInfo[]
    active: Record<string, unknown>
    signal?: AbortSignal
    reconnect?: boolean
  }): Promise<void>
  ready(): Promise<void>
  select(sdk: OpenCodeClient, sessionID: string | undefined): void
  snapshot(): FooterSubagentState
  settleForm(sessionID: string, formID: string): void
  close(): void
}

type DiscoveryJob = {
  sdk: OpenCodeClient
  sessionID: string
  signal: AbortSignal
  task: Promise<void>
  resolve: () => void
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

function sourceKey(messageID: string, callID: string) {
  return `${messageID}\u0000${callID}`
}

function permissionTool(request: PermissionV2Request, tools: Map<string, SessionMessageAssistantTool>) {
  if (request.source?.type !== "tool") return request
  const tool = tools.get(sourceKey(request.source.messageID, request.source.callID))
  return tool ? { ...request, tool } : request
}

function blockerCategory(event: V2Event): "permission" | "form" | undefined {
  if (event.type === "permission.v2.asked" || event.type === "permission.v2.replied") return "permission"
  if (event.type === "form.created" || event.type === "form.replied" || event.type === "form.cancelled") return "form"
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
    label: child.label,
    description: child.description || child.title || "",
    status: child.status,
    background: child.background ? true : undefined,
    title: child.title,
    lastUpdatedAt: child.lastUpdatedAt,
  }
}

export function createSubagentTracker(input: SubagentTrackerInput): SubagentTracker {
  const children = new Map<string, ChildState>()
  // Live subagent tool calls in the parent, so tool.success structured output
  // can be joined with the call's input metadata.
  const pendingCalls = new Map<string, Record<string, unknown>>()
  // Recently resolved non-family sessions. Retention is bounded so unrelated
  // process activity cannot grow tracker state for the lifetime of the TUI.
  const checked = new Set<string>()
  // Foreign events buffered while a session.get discovery is in flight, so a
  // fast child (including its settled event) is not lost mid-discovery.
  const pendingEvents = new Map<string, V2Event[]>()
  const hydrationEvents = new Map<string, V2Event[]>()
  const hydrationOverflow = new Set<string>()
  const hydrations = new Map<string, Promise<void>>()
  const blockerEvents = new Map<string, V2Event[]>()
  const blockerHydrations = new Map<string, Promise<void>>()
  const blockerRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const blockerRetryAttempts = new Map<string, number>()
  const discoveryJobs = new Map<string, DiscoveryJob>()
  const discoveryQueue: DiscoveryJob[] = []
  let activeDiscoveries = 0
  let selected: string | undefined
  let blockerEpoch = 0
  let closed = false
  const active = (signal = input.signal) => !closed && !input.signal.aborted && !signal.aborted
  const admitChild = (sessionID: string): ChildState | undefined => {
    const existing = children.get(sessionID)
    if (!existing && children.size >= FAMILY_LIST_LIMIT) return
    const child: ChildState = existing ?? {
      sessionID,
      label: FALLBACK_LABEL,
      description: "",
      status: "running",
      background: false,
      lastUpdatedAt: 0,
      frames: [],
      fragments: createFragmentReconciler(),
      tools: new Map(),
      toolSources: new Map(),
      finishedTools: new Set(),
      permissions: [],
      forms: [],
      messageIDs: new Set(),
      prompts: new Map(),
      hydrated: false,
      detailStale: false,
      blockersHydrated: false,
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
    const part = normalizeTool(item)
    const key = sourceKey(messageID, part.id)
    const frame = `tool:${key}`
    child.toolSources.set(key, part)
    if (part.state.status === "streaming") {
      child.tools.set(key, { part })
      return
    }
    const current = child.tools.get(key)
    const output = toolOutputText(part.name, part.state.content)
    if (part.state.status === "running") {
      if (!current || current.part.state.status === "streaming")
        setFrame(child, frame, toolCommit(part, messageID, "start", undefined, input.directory))
      if (output) setFrame(child, frame, toolCommit(part, messageID, "progress", output, input.directory))
      child.tools.set(key, { part })
      return
    }
    child.finishedTools.add(key)
    child.tools.delete(key)
    if (part.state.status === "error" && output) {
      setFrame(child, frame, toolCommit(part, messageID, "progress", output, input.directory))
      setFrame(child, `${frame}:final`, toolCommit(part, messageID, "final", undefined, input.directory))
      return
    }
    setFrame(child, frame, toolCommit(part, messageID, toolFinalPhase(part), undefined, input.directory))
  }

  const rebuild = (child: ChildState, messages: SessionMessageInfo[]) => {
    child.frames = []
    child.fragments.clear()
    child.finishedTools.clear()
    child.toolSources.clear()
    child.messageIDs.clear()
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
          const fragment = fragmentRef(message.id, "text", textOrdinal++)
          const update = child.fragments.project(fragment, item.text, true)
          setFrame(child, update.key, {
            kind: "assistant",
            source: "assistant",
            text: item.text,
            phase: "progress",
            messageID: message.id,
            partID: fragment.partID,
          })
          continue
        }
        if (item.type === "reasoning") {
          const fragment = fragmentRef(message.id, "reasoning", reasoningOrdinal++)
          const update = child.fragments.project(fragment, item.text, true)
          if (input.thinking)
            setFrame(child, update.key, {
              kind: "reasoning",
              source: "reasoning",
              text: `Thinking: ${item.text}`,
              phase: "progress",
              messageID: message.id,
              partID: fragment.partID,
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

  const hydrateChild = (sdk: OpenCodeClient, child: ChildState, signal = input.signal): Promise<void> => {
    if (!active(signal)) return Promise.resolve()
    const existing = hydrations.get(child.sessionID)
    if (existing) return existing
    const pendingPrompts = new Map(child.prompts)
    const pendingTools = new Map(child.tools)
    let retry = false
    const task = sdk.message
      .list({ sessionID: child.sessionID, limit: CHILD_MESSAGE_LIMIT, order: "desc" }, { signal })
      .then((response) => {
        if (!active(signal)) return
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
        child.permissions = child.permissions.map((request) => permissionTool(request, child.toolSources))
        for (const [id, tool] of pendingTools) {
          if (!child.finishedTools.has(id) && !child.tools.has(id)) child.tools.set(id, tool)
        }
        for (const event of buffered) reduce(child, event)
        child.hydrated = true
        child.detailStale = false
        notifyDetail(child)
      })
      .catch(() => {
        hydrationEvents.delete(child.sessionID)
        hydrationOverflow.delete(child.sessionID)
      })
      .finally(() => {
        hydrations.delete(child.sessionID)
        if (retry && active(signal)) queueMicrotask(() => void hydrateChild(sdk, child, signal))
      })
    hydrations.set(child.sessionID, task)
    return task
  }

  const blockerCurrent = (child: ChildState, epoch: number, signal = input.signal) =>
    active(signal) && epoch === blockerEpoch && children.get(child.sessionID) === child

  const resolvePermissionTools = async (
    sdk: OpenCodeClient,
    child: ChildState,
    permissions: PermissionV2Request[],
    epoch: number,
    signal = input.signal,
  ) => {
    const messageIDs = [
      ...new Set(
        permissions.flatMap((request) => {
          if (request.source?.type !== "tool") return []
          const key = sourceKey(request.source.messageID, request.source.callID)
          return child.toolSources.has(key) ? [] : [request.source.messageID]
        }),
      ),
    ]
    for (let offset = 0; offset < messageIDs.length; offset += FAMILY_DISCOVERY_CONCURRENCY) {
      const batch = messageIDs.slice(offset, offset + FAMILY_DISCOVERY_CONCURRENCY)
      const messages = await Promise.allSettled(
        batch.map((messageID) => sdk.session.message({ sessionID: child.sessionID, messageID }, { signal })),
      )
      if (!blockerCurrent(child, epoch, signal)) return permissions
      if (
        messages.some(
          (result, index) =>
            result.status !== "fulfilled" || result.value.type !== "assistant" || result.value.id !== batch[index],
        )
      )
        throw new Error("Permission source message is unavailable")
      for (const [index, result] of messages.entries()) {
        if (result.status !== "fulfilled" || result.value.type !== "assistant" || result.value.id !== batch[index])
          continue
        for (const item of result.value.content) {
          if (item.type !== "tool") continue
          child.toolSources.set(sourceKey(result.value.id, item.id), normalizeTool(item))
        }
      }
    }
    if (
      permissions.some(
        (request) =>
          request.source?.type === "tool" &&
          !child.toolSources.has(sourceKey(request.source.messageID, request.source.callID)),
      )
    )
      throw new Error("Permission source tool is unavailable")
    return permissions.map((request) => permissionTool(request, child.toolSources))
  }

  const replayBlockerEvents = (child: ChildState, category: "permission" | "form") => {
    for (const event of blockerEvents.get(child.sessionID) ?? []) {
      if (blockerCategory(event) === category) reduce(child, event)
    }
  }

  function scheduleBlockerRetry(sdk: OpenCodeClient, child: ChildState, epoch: number, signal = input.signal) {
    if (!blockerCurrent(child, epoch, signal) || child.blockersHydrated || blockerRetryTimers.has(child.sessionID))
      return
    const attempt = blockerRetryAttempts.get(child.sessionID) ?? 0
    const delay = Math.min(BLOCKER_RETRY_INITIAL_MS * 2 ** Math.min(attempt, 30), BLOCKER_RETRY_MAX_MS)
    blockerRetryAttempts.set(child.sessionID, attempt + 1)
    const timer = setTimeout(() => {
      if (blockerRetryTimers.get(child.sessionID) !== timer) return
      blockerRetryTimers.delete(child.sessionID)
      if (blockerCurrent(child, epoch, signal) && !child.blockersHydrated)
        void hydrateBlockers(sdk, child, epoch, signal)
    }, delay)
    blockerRetryTimers.set(child.sessionID, timer)
  }

  function hydrateBlockers(
    sdk: OpenCodeClient,
    child: ChildState,
    epoch = blockerEpoch,
    signal = input.signal,
  ): Promise<void> {
    if (!blockerCurrent(child, epoch, signal) || child.blockersHydrated) return Promise.resolve()
    const existing = blockerHydrations.get(child.sessionID)
    if (existing) return existing
    const timer = blockerRetryTimers.get(child.sessionID)
    if (timer) clearTimeout(timer)
    blockerRetryTimers.delete(child.sessionID)
    const tasks = [
      sdk.permission.list({ sessionID: child.sessionID }, { signal }).then(async (permissions) => {
        if (!blockerCurrent(child, epoch, signal)) return
        const resolved = await resolvePermissionTools(sdk, child, permissions, epoch, signal)
        if (!blockerCurrent(child, epoch, signal)) return
        child.permissions = resolved
        replayBlockerEvents(child, "permission")
        input.emit()
      }),
      sdk.form.list({ sessionID: child.sessionID }, { signal }).then((forms) => {
        if (!blockerCurrent(child, epoch, signal)) return
        child.forms = forms
        replayBlockerEvents(child, "form")
        input.emit()
      }),
    ]
    const task = Promise.allSettled(tasks)
      .then((results) => {
        if (!blockerCurrent(child, epoch, signal)) return
        blockerEvents.delete(child.sessionID)
        child.blockersHydrated = results.every((result) => result.status === "fulfilled")
        if (child.blockersHydrated) blockerRetryAttempts.delete(child.sessionID)
      })
      .finally(() => {
        blockerHydrations.delete(child.sessionID)
        if (blockerCurrent(child, epoch, signal) && !child.blockersHydrated)
          scheduleBlockerRetry(sdk, child, epoch, signal)
      })
    blockerHydrations.set(child.sessionID, task)
    return task
  }

  const resetBlockerHydration = () => {
    blockerEpoch++
    for (const timer of blockerRetryTimers.values()) clearTimeout(timer)
    blockerRetryTimers.clear()
    blockerRetryAttempts.clear()
    blockerEvents.clear()
    return blockerEpoch
  }

  const rememberChecked = (sessionID: string) => {
    checked.delete(sessionID)
    checked.add(sessionID)
    if (checked.size <= FAMILY_LIST_LIMIT) return
    const oldest = checked.values().next().value
    if (oldest) checked.delete(oldest)
  }

  const runDiscovery = async (job: DiscoveryJob) => {
    try {
      const lineage = []
      const visited = new Set<string>()
      let session = await job.sdk.session.get({ sessionID: job.sessionID }, { signal: job.signal })
      while (lineage.length < FAMILY_LIST_LIMIT && !visited.has(session.id)) {
        if (!active(job.signal)) return
        visited.add(session.id)
        lineage.push(session)
        if (session.parentID === input.sessionID || (session.parentID && children.has(session.parentID))) {
          const buffered = pendingEvents.get(job.sessionID) ?? []
          pendingEvents.delete(job.sessionID)
          for (const item of lineage.toReversed()) {
            const child = admitChild(item.id)
            if (!child) break
            if (item.agent) child.label = Locale.titlecase(item.agent)
            child.title = item.title
            touch(child, item.time.updated)
          }
          const child = children.get(job.sessionID)
          if (!child) return
          const blockers = hydrateBlockers(job.sdk, child, blockerEpoch, job.signal)
          blockerEvents.set(
            job.sessionID,
            buffered.filter((event) => blockerCategory(event) !== undefined),
          )
          for (const event of buffered) reduce(child, event)
          input.emit()
          void blockers
          void hydrateChild(job.sdk, child, job.signal)
          return
        }
        if (!session.parentID || visited.has(session.parentID)) break
        session = await job.sdk.session.get({ sessionID: session.parentID }, { signal: job.signal })
      }
      pendingEvents.delete(job.sessionID)
      rememberChecked(job.sessionID)
    } catch {
      // A later event may retry discovery after a transient lookup failure.
      pendingEvents.delete(job.sessionID)
    }
  }

  const pumpDiscoveries = () => {
    while (activeDiscoveries < FAMILY_DISCOVERY_CONCURRENCY) {
      const job = discoveryQueue.shift()
      if (!job) return
      activeDiscoveries++
      void runDiscovery(job).finally(() => {
        activeDiscoveries--
        if (discoveryJobs.get(job.sessionID) === job) discoveryJobs.delete(job.sessionID)
        job.resolve()
        pumpDiscoveries()
      })
    }
  }

  const discover = (sdk: OpenCodeClient, sessionID: string, signal = input.signal) => {
    if (!active(signal) || children.size >= FAMILY_LIST_LIMIT) return Promise.resolve()
    if (checked.has(sessionID) || children.has(sessionID) || sessionID === input.sessionID) return Promise.resolve()
    const existing = discoveryJobs.get(sessionID)
    if (existing) return existing.task
    let resolve!: () => void
    const task = new Promise<void>((done) => {
      resolve = done
    })
    const job = { sdk, sessionID, signal, task, resolve }
    discoveryJobs.set(sessionID, job)
    pendingEvents.set(sessionID, [])
    discoveryQueue.push(job)
    pumpDiscoveries()
    return task
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
      const update = child.fragments.delta(
        fragmentRef(event.data.assistantMessageID, "text", event.data.ordinal),
        event.data.delta,
      )
      if (!update) return
      setFrame(child, update.key, {
        kind: "assistant",
        source: "assistant",
        text: update.text,
        phase: "progress",
        messageID: event.data.assistantMessageID,
        partID: update.partID,
      })
      touch(child, event.created)
      notifyDetail(child)
      return
    }
    if (event.type === "session.text.ended") {
      const update = child.fragments.end(
        fragmentRef(event.data.assistantMessageID, "text", event.data.ordinal),
        event.data.text,
      )
      setFrame(child, update.key, {
        kind: "assistant",
        source: "assistant",
        text: event.data.text,
        phase: "progress",
        messageID: event.data.assistantMessageID,
        partID: update.partID,
      })
      touch(child, event.created)
      notifyDetail(child)
      return
    }
    if (event.type === "session.reasoning.started") {
      return
    }
    if (event.type === "session.reasoning.delta") {
      const update = child.fragments.delta(
        fragmentRef(event.data.assistantMessageID, "reasoning", event.data.ordinal),
        event.data.delta,
      )
      if (!update) return
      if (!input.thinking) return
      setFrame(child, update.key, {
        kind: "reasoning",
        source: "reasoning",
        text: `Thinking: ${update.text}`,
        phase: "progress",
        messageID: event.data.assistantMessageID,
        partID: update.partID,
      })
      notifyDetail(child)
      return
    }
    if (event.type === "session.reasoning.ended") {
      const update = child.fragments.end(
        fragmentRef(event.data.assistantMessageID, "reasoning", event.data.ordinal),
        event.data.text,
      )
      if (!input.thinking) return
      setFrame(child, update.key, {
        kind: "reasoning",
        source: "reasoning",
        text: `Thinking: ${event.data.text}`,
        phase: "progress",
        messageID: event.data.assistantMessageID,
        partID: update.partID,
      })
      notifyDetail(child)
      return
    }
    if (event.type === "session.tool.input.started") {
      if (child.finishedTools.has(sourceKey(event.data.assistantMessageID, event.data.callID))) return
      childTool(
        child,
        {
          type: "tool",
          id: event.data.callID,
          name: event.data.name,
          state: { status: "streaming", input: "" },
          time: { created: event.created },
        },
        event.data.assistantMessageID,
      )
      return
    }
    if (event.type === "session.tool.input.delta" || event.type === "session.tool.input.ended") {
      const current = child.tools.get(sourceKey(event.data.assistantMessageID, event.data.callID))
      if (!current || current.part.state.status !== "streaming") return
      childTool(
        child,
        {
          ...current.part,
          state: {
            status: "streaming",
            input:
              event.type === "session.tool.input.ended" ? event.data.text : current.part.state.input + event.data.delta,
          },
        },
        event.data.assistantMessageID,
      )
      return
    }
    if (event.type === "session.tool.called") {
      const key = sourceKey(event.data.assistantMessageID, event.data.callID)
      if (child.finishedTools.has(key)) return
      const current = child.tools.get(key)
      childTool(
        child,
        {
          type: "tool",
          id: event.data.callID,
          name: current?.part.name ?? "tool",
          executed: event.data.executed,
          providerState: event.data.state,
          state: { status: "running", input: event.data.input, structured: {}, content: [] },
          time: { created: current?.part.time.created ?? event.created, ran: event.created },
        },
        event.data.assistantMessageID,
      )
      touch(child, event.created)
      notifyDetail(child)
      return
    }
    if (event.type === "session.tool.progress") {
      const key = sourceKey(event.data.assistantMessageID, event.data.callID)
      if (child.finishedTools.has(key)) return
      const current = child.tools.get(key)
      const part = current?.part
      childTool(
        child,
        {
          type: "tool",
          id: event.data.callID,
          name: part?.name ?? "tool",
          executed: part?.executed,
          providerState: part?.providerState,
          state: {
            status: "running",
            input: part && part.state.status !== "streaming" ? part.state.input : {},
            structured: event.data.structured,
            content: event.data.content,
          },
          time: {
            created: part?.time.created ?? event.created,
            ran: part?.time.ran ?? event.created,
          },
        },
        event.data.assistantMessageID,
      )
      touch(child, event.created)
      notifyDetail(child)
      return
    }
    if (event.type === "session.tool.success" || event.type === "session.tool.failed") {
      const key = sourceKey(event.data.assistantMessageID, event.data.callID)
      if (child.finishedTools.has(key)) return
      const current = child.tools.get(key)
      const part = current?.part
      const failed = event.type === "session.tool.failed"
      childTool(
        child,
        {
          type: "tool",
          id: event.data.callID,
          name: part?.name ?? "tool",
          executed: event.data.executed,
          providerState: part?.providerState,
          providerResultState: event.data.resultState,
          state: failed
            ? {
                status: "error",
                input: part && part.state.status !== "streaming" ? part.state.input : {},
                structured: part && part.state.status !== "streaming" ? part.state.structured : {},
                content: part && part.state.status !== "streaming" ? part.state.content : [],
                error: event.data.error,
                result: event.data.result,
              }
            : {
                status: "completed",
                input: part && part.state.status !== "streaming" ? part.state.input : {},
                structured: event.data.structured,
                content: event.data.content,
                result: event.data.result,
              },
          time: {
            created: part?.time.created ?? event.created,
            ran: part?.time.ran,
            completed: event.created,
          },
        },
        event.data.assistantMessageID,
      )
      touch(child, event.created)
      notifyDetail(child)
      return
    }
    if (event.type === "permission.v2.asked") {
      if (!child.permissions.some((item) => item.id === event.data.id))
        child.permissions.push(permissionTool(event.data, child.toolSources))
      input.emit()
      return
    }
    if (event.type === "permission.v2.replied") {
      child.permissions = child.permissions.filter((item) => item.id !== event.data.requestID)
      input.emit()
      return
    }
    if (event.type === "form.created") {
      if (!child.forms.some((item) => item.id === event.data.form.id)) child.forms.push(event.data.form)
      input.emit()
      return
    }
    if (event.type === "form.replied" || event.type === "form.cancelled") {
      child.forms = child.forms.filter((item) => item.id !== event.data.id)
      input.emit()
      return
    }
    if (event.type === "session.step.ended") return
    if (event.type === "session.step.failed") {
      setFrame(child, `error:${event.data.assistantMessageID}`, {
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
    const tool = normalizeTool(item)
    if (tool.name !== "subagent" || tool.state.status === "streaming") return
    const found = childSessionID(record(tool.state.structured))
    if (!found) return
    const child = admitChild(found.sessionID)
    if (!child) return
    applyMeta(child, record(tool.state.input))
    if (tool.state.status === "completed" && found.running) child.background = true
    if (child.status === "running") {
      const running = found.running && (!active || found.sessionID in active)
      child.status = running ? "running" : "completed"
    }
    touch(child, tool.time.completed ?? tool.time.created)
  }

  const settleHydrations = async () => {
    while (true) {
      await Promise.resolve()
      const pending = [...discoveryJobs.values()]
        .map((job) => job.task)
        .concat([...hydrations.values(), ...blockerHydrations.values()])
      if (pending.length === 0) return
      await Promise.allSettled(pending)
    }
  }

  return {
    main(sdk, event, signal = input.signal) {
      if (!active(signal)) return
      if (event.type === "session.tool.input.started") {
        if (canonicalToolName(event.data.name) === "subagent")
          pendingCalls.set(sourceKey(event.data.assistantMessageID, event.data.callID), {})
        return
      }
      if (event.type === "session.tool.called") {
        const key = sourceKey(event.data.assistantMessageID, event.data.callID)
        if (pendingCalls.has(key)) pendingCalls.set(key, event.data.input)
        return
      }
      if (event.type === "session.tool.failed") {
        pendingCalls.delete(sourceKey(event.data.assistantMessageID, event.data.callID))
        return
      }
      if (event.type !== "session.tool.progress" && event.type !== "session.tool.success") return
      const key = sourceKey(event.data.assistantMessageID, event.data.callID)
      const pending = pendingCalls.get(key)
      if (event.type === "session.tool.success") pendingCalls.delete(key)
      const found = childSessionID(record(event.data.structured))
      if (!found) return
      const child = admitChild(found.sessionID)
      if (!child) return
      applyMeta(child, pending)
      if (event.type === "session.tool.success" && found.running) {
        child.background = true
        child.status = "running"
      }
      if (event.type === "session.tool.success" && !found.running && child.status === "running")
        child.status = "completed"
      touch(child, event.created)
      input.emit()
      if (!child.blockersHydrated) void hydrateBlockers(sdk, child, blockerEpoch, signal)
      if (!child.hydrated) void hydrateChild(sdk, child, signal)
    },
    foreign(sdk, sessionID, event, signal = input.signal) {
      if (!active(signal)) return
      const child = children.get(sessionID)
      if (child) {
        if (blockerHydrations.has(sessionID) && blockerCategory(event)) {
          const buffered = blockerEvents.get(sessionID) ?? []
          if (buffered.length < CHILD_EVENT_BUFFER_LIMIT) buffered.push(event)
          blockerEvents.set(sessionID, buffered)
        }
        if (hydrations.has(sessionID)) {
          const buffered = hydrationEvents.get(sessionID) ?? []
          if (buffered.length < CHILD_EVENT_BUFFER_LIMIT) buffered.push(event)
          else hydrationOverflow.add(sessionID)
          hydrationEvents.set(sessionID, buffered)
        }
        reduce(child, event)
        return
      }
      void discover(sdk, sessionID, signal)
      const buffered = pendingEvents.get(sessionID)
      if (buffered && buffered.length < CHILD_EVENT_BUFFER_LIMIT) buffered.push(event)
    },
    async hydrate(next) {
      const signal = next.signal ?? input.signal
      if (!active(signal)) return
      const blockerHydrationEpoch = resetBlockerHydration()
      await settleHydrations()
      if (!active(signal)) return
      if (next.reconnect) {
        for (const child of children.values()) {
          child.hydrated = false
          child.detailStale = true
        }
      }
      for (const message of next.messages) {
        if (message.type !== "assistant") continue
        for (const item of message.content) {
          if (item.type === "tool") mainTool(item, next.active)
        }
      }
      // Family index: adopt children directly from the current session list so
      // historical subagents beyond the projected message window still get tabs.
      const queue = [input.sessionID]
      const visited = new Set(queue)
      while (queue.length > 0 && children.size < FAMILY_LIST_LIMIT) {
        const owner = queue.shift()
        if (!owner) continue
        const family = await next.sdk.session
          .list({ parentID: owner, limit: FAMILY_LIST_LIMIT - children.size, order: "desc" }, { signal })
          .then((response) => response.data)
          .catch(() => [])
        if (!active(signal)) return
        for (const session of family) {
          if (visited.has(session.id) || children.size >= FAMILY_LIST_LIMIT) continue
          visited.add(session.id)
          const child = admitChild(session.id)
          if (!child) break
          if (session.agent && child.label === FALLBACK_LABEL) child.label = Locale.titlecase(session.agent)
          if (!child.title) child.title = session.title
          touch(child, session.time.updated)
          queue.push(session.id)
        }
      }
      const activeSessions = Object.keys(next.active)
      for (
        let offset = 0;
        offset < activeSessions.length && children.size < FAMILY_LIST_LIMIT;
        offset += FAMILY_DISCOVERY_CONCURRENCY
      )
        await Promise.all(
          activeSessions
            .slice(offset, offset + FAMILY_DISCOVERY_CONCURRENCY)
            .map((sessionID) => discover(next.sdk, sessionID, signal)),
        )
      if (!active(signal)) return
      for (const child of children.values()) {
        // Reconnect can miss a child's settled event; the active map is the
        // authoritative live signal for still-running children.
        if (child.status === "running" && !(child.sessionID in next.active)) child.status = "completed"
        child.blockersHydrated = false
      }
      const descendants = [...children.values()]
      for (let offset = 0; offset < descendants.length; offset += FAMILY_DISCOVERY_CONCURRENCY)
        await Promise.all(
          descendants
            .slice(offset, offset + FAMILY_DISCOVERY_CONCURRENCY)
            .map((child) => hydrateBlockers(next.sdk, child, blockerHydrationEpoch, signal)),
        )
      if (!active(signal)) return
      const current = selected ? children.get(selected) : undefined
      if (current) await hydrateChild(next.sdk, current, signal)
      if (!active(signal)) return
      if (children.size > 0) input.emit()
    },
    ready: settleHydrations,
    select(sdk, sessionID) {
      selected = sessionID
      const child = sessionID ? children.get(sessionID) : undefined
      if (child && !child.hydrated) void hydrateChild(sdk, child)
      input.emit()
    },
    snapshot() {
      const tabs = [...children.values()].map(tab).toSorted((a, b) => {
        const active = Number(b.status === "running") - Number(a.status === "running")
        if (active !== 0) return active
        return b.lastUpdatedAt - a.lastUpdatedAt
      })
      const child = selected ? children.get(selected) : undefined
      const details: Record<string, FooterSubagentDetail> =
        child && !child.detailStale ? { [child.sessionID]: { commits: child.frames.map((item) => item.commit) } } : {}
      return {
        tabs,
        details,
        permissions: [...children.values()].flatMap((item) => item.permissions),
        forms: [...children.values()].flatMap((item) => item.forms),
      }
    },
    settleForm(sessionID, formID) {
      const child = children.get(sessionID)
      if (!child) return
      child.forms = child.forms.filter((item) => item.id !== formID)
      input.emit()
    },
    close() {
      closed = true
      resetBlockerHydration()
      for (const job of discoveryQueue.splice(0)) {
        if (discoveryJobs.get(job.sessionID) === job) discoveryJobs.delete(job.sessionID)
        job.resolve()
      }
      hydrationEvents.clear()
      hydrationOverflow.clear()
      pendingEvents.clear()
    },
  }
}

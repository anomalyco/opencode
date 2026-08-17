import { base64Encode } from "@opencode-ai/core/util/encode"
import type {
  JsonValue,
  OpenCodeEvent,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageUser,
  SessionStatus,
  SessionStructuredError,
} from "@opencode-ai/client/promise"
import { EventManifest } from "@opencode-ai/schema/event-manifest"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { expect, type Page } from "@playwright/test"
import { Schema } from "effect"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { installSseTransport } from "../../utils/sse-transport"
import { expectSessionReady } from "../../utils/waits"

export const directory = "C:/OpenCode/TimelineStability"
export const projectID = "proj_timeline_stability"
export const sessionID = "ses_timeline_stability"
export const userID = "msg_1000_timeline_user"
export const assistantID = "msg_1001_timeline_assistant"
export const title = "Timeline visual stability"
export const model = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }

const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const tokens = { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } }

type Session = SessionInfo
type TextSeed = {
  id: string
  type: "text"
  text: string
  messageID?: string
}
type FileSeed = {
  id: string
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: { type: string; path?: string; text?: { value: string; start: number; end: number } }
}
type AgentSeed = {
  id: string
  type: "agent"
  name: string
  source?: { value: string; start: number; end: number }
}
type ReasoningSeed = {
  id: string
  type: "reasoning"
  text: string
  time?: { start: number; end?: number }
  metadata?: Record<string, unknown>
  messageID?: string
}
type ToolSeed = {
  id: string
  type: "tool"
  callID: string
  tool: string
  messageID?: string
  executed?: boolean
  providerState?: Record<string, unknown>
  providerResultState?: Record<string, unknown>
  state:
    | { status: "pending"; input: Record<string, unknown>; raw: string }
    | {
        status: "running"
        input: Record<string, unknown>
        title?: string
        metadata: Record<string, unknown>
        time: { start: number }
      }
    | {
        status: "completed"
        input: Record<string, unknown>
        output: string
        title: string
        metadata: Record<string, unknown>
        time: { start: number; end: number }
      }
    | {
        status: "error"
        input: Record<string, unknown>
        error: string
        metadata: Record<string, unknown>
        time: { start: number; end: number }
      }
}

export type TimelineMessage = SessionMessageUser | SessionMessageAssistant
export type TimelineEvent = OpenCodeEvent | readonly OpenCodeEvent[]
export type EventPayload = OpenCodeEvent
export type ToolStatus = ToolSeed["state"]["status"]
export type PartSeed<Owner extends "user" | "assistant"> = Owner extends "user"
  ? TextSeed | FileSeed | AgentSeed
  : TextSeed | ReasoningSeed | ToolSeed

type ToolOptions<State extends ToolStatus> = State extends "pending"
  ? { output?: never; title?: never; metadata?: never; error?: never }
  : State extends "running"
    ? { title?: string; metadata?: Record<string, unknown>; output?: never; error?: never }
    : State extends "error"
      ? { error?: string; metadata?: Record<string, unknown>; output?: never; title?: never }
      : { output?: string; title?: string; metadata?: Record<string, unknown>; error?: never }

type PartRef = { messageID: string; type: "text" | "reasoning" | "tool"; ordinal?: number }
const partRefs = new Map<string, PartRef>()
const nextOrdinals = new Map<string, { text: number; reasoning: number }>()
const startedParts = new Set<string>()
const toolStates = new Map<string, ToolStatus>()
let eventSequence = 0
let durableSequence = -1

export async function setupTimeline(
  page: Page,
  input: {
    messages?: TimelineMessage[]
    sessionMessages?: SessionMessageInfo[]
    sessionStatus?: Record<string, SessionStatus>
    settings?: Record<string, boolean>
    sessions?: Session[]
    cpuRate?: number
    viewport?: { width: number; height: number }
    eventRetry?: number
    reducedMotion?: boolean
    locale?: string
    deviceScaleFactor?: number
    seedHistory?: boolean
  } = {},
) {
  eventSequence = 0
  durableSequence = -1
  const sessions = input.sessions ?? [session()]
  const messages =
    input.sessionMessages ??
    validateTimelineMessages([
      ...(input.seedHistory ? historyMessages(18) : []),
      ...(input.messages ?? [userMessage(), assistantMessage()]),
    ])
  const active = messages.findLast((message) => message.type === "assistant")
  const initialStatus: SessionStatus =
    active?.type === "assistant" && active.time.completed === undefined ? { type: "busy" } : { type: "idle" }
  const transport = await installSseTransport(page, { server, retry: input.eventRetry ?? 20 })
  await mockOpenCodeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions,
    sessionStatus: input.sessionStatus ?? { [sessionID]: initialStatus },
    pageMessages: () => ({ items: messages }),
  })
  await page.addInitScript((settings) => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          editToolPartsExpanded: false,
          shellToolPartsExpanded: false,
          showReasoningSummaries: false,
          showSessionProgressBar: true,
          ...settings,
        },
      }),
    )
  }, input.settings ?? {})
  if (input.locale) {
    await page.addInitScript((locale) => {
      localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale }))
    }, input.locale)
  }
  if (input.reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize(input.viewport ?? { width: 1400, height: 900 })
  if (input.deviceScaleFactor) {
    const devtools = await page.context().newCDPSession(page)
    const viewport = input.viewport ?? { width: 1400, height: 900 }
    await devtools.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: input.deviceScaleFactor,
      mobile: false,
    })
  }
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionReady(page, { server, sessionID, title })
  await transport.waitForConnection()
  if (input.cpuRate && input.cpuRate > 1) {
    const devtools = await page.context().newCDPSession(page)
    await devtools.send("Emulation.setCPUThrottlingRate", { rate: input.cpuRate })
  }

  return {
    transport,
    async send(input: TimelineEvent, delay = 0) {
      const events = timelineEvents(input)
      if (events.length === 1) await transport.send(events[0]!, { marker: describeEvent(events[0]!) })
      if (events.length > 1)
        await transport.burst(
          events,
          events.map((item) => ({ marker: describeEvent(item) })),
        )
      if (delay) await page.waitForTimeout(delay)
    },
    async sendAll(sequence: { event: TimelineEvent; delay: number }[]) {
      for (const item of sequence) {
        const events = timelineEvents(item.event)
        if (events.length === 1) await transport.send(events[0]!, { marker: describeEvent(events[0]!) })
        if (events.length > 1)
          await transport.burst(
            events,
            events.map((event) => ({ marker: describeEvent(event) })),
          )
        await page.waitForTimeout(item.delay)
      }
    },
    async settle(frames = 3) {
      await page.evaluate(
        (frames) =>
          new Promise<void>((resolve) => {
            let remaining = frames
            const tick = () => {
              remaining--
              if (remaining <= 0) return resolve()
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          }),
        frames,
      )
    },
    async waitForPart(partID: string) {
      const part = page.locator(`[data-timeline-part-id="${renderedPartID(partID)}"]`)
      await expect(part).toHaveCount(1)
      await expect(part).toBeVisible()
    },
  }
}

function timelineEvents(input: TimelineEvent) {
  return (Array.isArray(input) ? input : [input]).map(validateTimelineEvent)
}

function describeEvent(event: OpenCodeEvent) {
  if (event.type.startsWith("session.tool.")) {
    const data = event.data as { id?: string }
    return [event.type, data.id].filter(Boolean).join(":")
  }
  return event.type
}

export function event(
  type: "session.status",
  data: Extract<OpenCodeEvent, { type: "session.status" }>["data"],
): OpenCodeEvent {
  return makeEvent(type, data)
}

export function validateTimelineEvent(input: unknown): OpenCodeEvent {
  if (!input || typeof input !== "object") throw new Error("Timeline event must be an object")
  if (!("type" in input) || typeof input.type !== "string") throw new Error("Timeline event requires a type")
  const definition = EventManifest.ServerDefinitions.find((definition) => definition.type === input.type)
  if (!definition) throw new Error(`Unknown timeline event: ${input.type}`)
  return Schema.decodeUnknownSync(definition)(input) as OpenCodeEvent
}

export function validateTimelineMessages(input: readonly TimelineMessage[]): TimelineMessage[] {
  const messages = input.map((message): TimelineMessage => {
    const decoded = Schema.decodeUnknownSync(SessionMessage.Info)(message)
    if (decoded.type !== "user" && decoded.type !== "assistant")
      throw new Error(`Unsupported timeline message type: ${decoded.type}`)
    return message
  })
  const messageIDs = new Set<string>()
  let parentID: string | undefined
  messages.forEach((message) => {
    if (messageIDs.has(message.id)) throw new Error(`Timeline fixture has duplicate message ID: ${message.id}`)
    messageIDs.add(message.id)
    if (message.type === "user") parentID = message.id
    if (message.type === "assistant") {
      const expected = typeof message.metadata?.parentID === "string" ? message.metadata.parentID : parentID
      if (!expected || expected !== parentID)
        throw new Error(`Timeline assistant ${message.id} must reference a parent user in the fixture`)
      message.content.forEach((part) => {
        if (part.type !== "tool") return
        if (partRefs.has(part.id) && partRefs.get(part.id)?.messageID !== message.id)
          throw new Error(`Timeline fixture has duplicate part ID: ${part.id}`)
      })
    }
  })
  return messages
}

export async function waitForVisualSettle(page: Page, selectors: string[], stableFrames = 3) {
  await page.waitForFunction(
    ({ selectors, stableFrames }) => {
      const elements = selectors.map((selector) => document.querySelector<HTMLElement>(selector))
      if (elements.some((element) => !element)) return false
      return new Promise<boolean>((resolve) => {
        let stable = 0
        let previous = ""
        const sample = () => {
          const signature = JSON.stringify(
            elements.map((element) => {
              const rect = element!.getBoundingClientRect()
              return [Math.round(rect.top * 10), Math.round(rect.bottom * 10), Math.round(rect.height * 10)]
            }),
          )
          stable = signature === previous ? stable + 1 : 0
          previous = signature
          const ordered = elements
            .slice(1)
            .every(
              (element, index) =>
                elements[index]!.getBoundingClientRect().bottom <= element!.getBoundingClientRect().top + 0.5,
            )
          if (stable >= stableFrames && ordered) return resolve(true)
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
    },
    { selectors, stableFrames },
  )
}

export function historyMessages(count: number): TimelineMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const value = String(index).padStart(4, "0")
    const historyUserID = `msg_0${value}_history_a_user`
    return [
      userMessage(undefined, { id: historyUserID, created: 1690000000000 + index * 10_000 }),
      assistantMessage(
        [
          {
            id: `prt_0${value}_history_text`,
            type: "text",
            text: `Historical response ${index}. ${"Existing session content keeps the virtual timeline realistic. ".repeat(5)}`,
          },
        ],
        {
          id: `msg_0${value}_history_b_assistant`,
          parentID: historyUserID,
          created: 1690000001000 + index * 10_000,
        },
      ),
    ]
  }).flat()
}

export function partUpdated(part: PartSeed<"assistant">): readonly OpenCodeEvent[] {
  const messageID = part.messageID ?? assistantID
  const started = startedParts.has(part.id)
  const ref = partRef(part.id, messageID, part.type)
  if (part.type === "text") {
    startedParts.add(part.id)
    return [
      ...(started
        ? []
        : [makeEvent("session.text.started", { sessionID, assistantMessageID: messageID, ordinal: ref.ordinal! })]),
      makeEvent("session.text.ended", {
        sessionID,
        assistantMessageID: messageID,
        ordinal: ref.ordinal!,
        text: part.text,
      }),
    ]
  }
  if (part.type === "reasoning") {
    startedParts.add(part.id)
    return [
      ...(started
        ? []
        : [
            makeEvent("session.reasoning.started", {
              sessionID,
              assistantMessageID: messageID,
              ordinal: ref.ordinal!,
              state: jsonRecord(part.metadata),
            }),
          ]),
      makeEvent("session.reasoning.ended", {
        sessionID,
        assistantMessageID: messageID,
        ordinal: ref.ordinal!,
        text: part.text,
        state: jsonRecord(part.metadata),
      }),
    ]
  }
  return toolEvents(part, messageID)
}

export function renderedPartID(partID: string) {
  const ref = partRefs.get(partID)
  if (!ref || ref.type === "tool") return partID
  return `${ref.messageID}:${ref.type}:${ref.ordinal}`
}

export function partDelta(partID: string, delta: string, messageID = assistantID) {
  const ref = partRefs.get(partID)
  if (!ref || ref.type !== "text" || ref.ordinal === undefined) throw new Error(`Unknown text part: ${partID}`)
  return makeEvent("session.text.delta", {
    sessionID,
    assistantMessageID: messageID,
    ordinal: ref.ordinal,
    delta,
  })
}

export function messageUpdated(info: SessionMessageAssistant) {
  if (info.error)
    return makeEvent("session.step.failed", {
      sessionID,
      assistantMessageID: info.id,
      error: info.error,
      cost: info.cost,
      tokens: info.tokens,
    })
  return makeEvent("session.step.ended", {
    sessionID,
    assistantMessageID: info.id,
    finish: info.finish ?? "stop",
    cost: info.cost ?? 0,
    tokens: info.tokens ?? tokens,
  })
}

export function status(type: SessionStatus["type"], attempt = 1) {
  if (type === "busy") return makeEvent("session.execution.started", { sessionID })
  if (type === "idle") return makeEvent("session.execution.succeeded", { sessionID })
  return makeEvent("session.retry.scheduled", {
    sessionID,
    assistantMessageID: assistantID,
    attempt,
    at: 1700000010000,
    error: { type: "provider.error", message: "Rate limited" },
  })
}

export function userMessage(
  parts?: PartSeed<"user">[],
  input: { id?: string; summary?: unknown; created?: number } = {},
): SessionMessageUser {
  const id = input.id ?? userID
  const seeds = parts ?? [userText("Build the timeline stability matrix.", { id: `prt_${id}_text` })]
  return {
    id,
    type: "user",
    time: { created: input.created ?? 1700000000000 },
    text: seeds.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
    files: seeds.flatMap((part) => {
      if (part.type !== "file") return []
      const mention = part.source?.text
        ? { text: part.source.text.value, start: part.source.text.start, end: part.source.text.end }
        : undefined
      return [
        {
          data: part.url.match(/^data:[^,]*;base64,(.*)$/)?.[1] ?? "",
          mime: part.mime,
          source: part.url.startsWith("data:")
            ? ({ type: "inline" } as const)
            : ({ type: "uri", uri: part.source?.path ?? part.url } as const),
          ...(part.filename ? { name: part.filename } : {}),
          ...(mention ? { mention } : {}),
        },
      ]
    }),
    agents: seeds.flatMap((part) => {
      if (part.type !== "agent") return []
      return [
        {
          name: part.name,
          ...(part.source
            ? { mention: { text: part.source.value, start: part.source.start, end: part.source.end } }
            : {}),
        },
      ]
    }),
    ...(input.summary === undefined ? {} : { metadata: { summary: input.summary as JsonValue } }),
  }
}

export function assistantMessage(
  parts: PartSeed<"assistant">[] = [],
  input: {
    id?: string
    parentID?: string
    completed?: boolean
    error?: SessionStructuredError
    created?: number
  } = {},
): SessionMessageAssistant {
  if (input.error && (typeof input.error.type !== "string" || typeof input.error.message !== "string"))
    throw new Error("Invalid assistant error")
  const id = input.id ?? assistantID
  const created = input.created ?? 1700000001000
  const ordinals = { text: 0, reasoning: 0 }
  const content = parts.map((part) => messageContent(part, id, ordinals))
  nextOrdinals.set(id, ordinals)
  return {
    id,
    type: "assistant",
    metadata: { parentID: input.parentID ?? userID },
    time: { created, ...(input.completed === false ? {} : { completed: created + 1_000 }) },
    model: { id: model.modelID, providerID: model.providerID, variant: model.variant },
    agent: "build",
    content,
    cost: 0.01,
    tokens,
    ...(input.completed === false ? {} : { finish: "stop" as const }),
    ...(input.error ? { error: input.error } : {}),
  }
}

export function userText(text: string, input: Partial<Omit<TextSeed, "type" | "text">> = {}): TextSeed {
  return { id: "prt_user_text", type: "text", text, ...input }
}

export function textPart(id: string, text: string): TextSeed {
  partRef(id, assistantID, "text")
  return { id, type: "text", text }
}

export function reasoningPart(id: string, text: string): ReasoningSeed {
  partRef(id, assistantID, "reasoning")
  return { id, type: "reasoning", text, time: { start: 1700000001000 } }
}

export function toolPart(
  id: string,
  tool: string,
  state: "pending",
  input: Record<string, unknown>,
  options?: ToolOptions<"pending">,
): ToolSeed
export function toolPart(
  id: string,
  tool: string,
  state: "running",
  input: Record<string, unknown>,
  options?: ToolOptions<"running">,
): ToolSeed
export function toolPart(
  id: string,
  tool: string,
  state: "completed",
  input: Record<string, unknown>,
  options?: ToolOptions<"completed">,
): ToolSeed
export function toolPart(
  id: string,
  tool: string,
  state: "error",
  input: Record<string, unknown>,
  options?: ToolOptions<"error">,
): ToolSeed
export function toolPart(
  id: string,
  tool: string,
  state: ToolStatus,
  input: Record<string, unknown>,
  options: ToolOptions<ToolStatus> = {},
): ToolSeed {
  const base = { id, type: "tool" as const, callID: id, tool }
  if (state === "pending") return { ...base, state: { status: state, input, raw: "" } }
  if (state === "running")
    return {
      ...base,
      state: {
        status: state,
        input,
        title: options.title,
        metadata: options.metadata ?? {},
        time: { start: 1700000001000 },
      },
    }
  if (state === "error")
    return {
      ...base,
      state: {
        status: state,
        input,
        error: options.error ?? "Tool failed",
        metadata: options.metadata ?? {},
        time: { start: 1700000001000, end: 1700000002000 },
      },
    }
  return {
    ...base,
    state: {
      status: state,
      input,
      output: options.output ?? "Completed",
      title: options.title ?? tool,
      metadata: options.metadata ?? {},
      time: { start: 1700000001000, end: 1700000002000 },
    },
  }
}

export function shell(id: string, state: ToolStatus, output = "", command = `echo ${id}`): ToolSeed {
  if (state === "pending") return toolPart(id, "bash", state, { command })
  if (state === "running")
    return toolPart(id, "bash", state, { command }, { title: command, metadata: { command, output } })
  if (state === "error")
    return toolPart(id, "bash", state, { command }, { error: output || undefined, metadata: { command, output } })
  return toolPart(id, "bash", state, { command }, { title: command, output, metadata: { command, output } })
}

export function completedAssistantInfo(info: SessionMessageAssistant): SessionMessageAssistant {
  return { ...info, time: { ...info.time, completed: 1700000003000 } }
}

export function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "timeline-stability",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

export function session(input: Partial<Session> = {}): Session {
  return {
    id: sessionID,
    projectID,
    location: { directory },
    title,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1700000000000, updated: 1700000000000 },
    ...input,
  }
}

function messageContent(
  part: PartSeed<"assistant">,
  messageID: string,
  ordinals: { text: number; reasoning: number },
): SessionMessageAssistant["content"][number] {
  if (part.type === "tool") {
    partRefs.set(part.id, { messageID, type: part.type })
    toolStates.set(part.callID, part.state.status)
  } else {
    partRefs.set(part.id, { messageID, type: part.type, ordinal: ordinals[part.type]++ })
    startedParts.add(part.id)
  }
  if (part.type === "text") return { type: "text", text: part.text }
  if (part.type === "reasoning")
    return {
      type: "reasoning",
      text: part.text,
      state: jsonRecord(part.metadata),
      time: part.time
        ? { created: part.time.start, ...(part.time.end === undefined ? {} : { completed: part.time.end }) }
        : undefined,
    }
  const state = part.state
  const time = "time" in state ? state.time : undefined
  const completed = state.status === "completed" || state.status === "error" ? state.time.end : undefined
  const base = {
    type: "tool" as const,
    id: part.callID,
    name: part.tool,
    time: {
      created: time?.start ?? 1700000001000,
      ...(time?.start === undefined ? {} : { ran: time.start }),
      ...(completed === undefined ? {} : { completed }),
    },
    ...(part.executed === undefined ? {} : { executed: part.executed }),
    ...(part.providerState ? { providerState: jsonRecord(part.providerState) } : {}),
    ...(part.providerResultState ? { providerResultState: jsonRecord(part.providerResultState) } : {}),
  }
  if (state.status === "pending") return { ...base, state: { status: "streaming", input: state.raw } }
  if (state.status === "running")
    return {
      ...base,
      state: { status: "running", input: jsonRecord(state.input), metadata: jsonRecord(state.metadata) },
    }
  if (state.status === "error")
    return {
      ...base,
      state: {
        status: "error",
        input: jsonRecord(state.input),
        error: { type: "ToolError", message: state.error },
        metadata: jsonRecord(state.metadata),
      },
    }
  return {
    ...base,
    state: {
      status: "completed",
      input: jsonRecord(state.input),
      content: [{ type: "text", text: state.output }],
      metadata: jsonRecord(state.metadata),
    },
  }
}

function toolEvents(part: ToolSeed, messageID: string): readonly OpenCodeEvent[] {
  const previous = toolStates.get(part.callID)
  if (previous === "completed" || previous === "error") return []

  const events: OpenCodeEvent[] = []
  if (!previous) {
    events.push(
      makeEvent("session.tool.input.started", {
        sessionID,
        assistantMessageID: messageID,
        id: part.callID,
        name: part.tool,
      }),
    )
  }
  if (part.state.status === "pending") {
    toolStates.set(part.callID, part.state.status)
    return events
  }
  if (!previous || previous === "pending") {
    events.push(
      makeEvent("session.tool.input.ended", {
        sessionID,
        assistantMessageID: messageID,
        id: part.callID,
        text: JSON.stringify(part.state.input),
      }),
      makeEvent("session.tool.called", {
        sessionID,
        assistantMessageID: messageID,
        id: part.callID,
        input: part.state.input,
        executed: part.executed ?? true,
        state: jsonRecord(part.providerState),
      }),
    )
  }
  if (part.state.status === "running") {
    if (previous === "running" || Object.keys(part.state.metadata).length)
      events.push(
        makeEvent("session.tool.progress", {
          sessionID,
          assistantMessageID: messageID,
          id: part.callID,
          metadata: jsonRecord(part.state.metadata),
        }),
      )
    toolStates.set(part.callID, part.state.status)
    return events
  }
  if (part.state.status === "error") {
    events.push(
      makeEvent("session.tool.failed", {
        sessionID,
        assistantMessageID: messageID,
        id: part.callID,
        error: { type: "ToolError", message: part.state.error },
        metadata: jsonRecord(part.state.metadata),
        executed: part.executed ?? true,
        resultState: jsonRecord(part.providerResultState),
      }),
    )
    toolStates.set(part.callID, part.state.status)
    return events
  }
  events.push(
    makeEvent("session.tool.success", {
      sessionID,
      assistantMessageID: messageID,
      id: part.callID,
      content: [{ type: "text", text: part.state.output }],
      metadata: jsonRecord(part.state.metadata),
      executed: part.executed ?? true,
      resultState: jsonRecord(part.providerResultState),
    }),
  )
  toolStates.set(part.callID, part.state.status)
  return events
}

function partRef(id: string, messageID: string, type: PartRef["type"]): PartRef {
  const current = partRefs.get(id)
  if (current) return current
  if (type === "tool") {
    const ref = { messageID, type } satisfies PartRef
    partRefs.set(id, ref)
    return ref
  }
  const next = nextOrdinals.get(messageID) ?? { text: 0, reasoning: 0 }
  const ref = { messageID, type, ordinal: next[type]++ } satisfies PartRef
  nextOrdinals.set(messageID, next)
  partRefs.set(id, ref)
  return ref
}

function makeEvent<Type extends OpenCodeEvent["type"]>(
  type: Type,
  data: Extract<OpenCodeEvent, { type: Type }>["data"],
): OpenCodeEvent {
  const id = `evt_timeline_${String(++eventSequence).padStart(4, "0")}`
  const base = { id, created: 1700000002000 + eventSequence, type, data, location: { directory } }
  const definition = EventManifest.ServerDefinitions.find((definition) => definition.type === type)
  if (!definition) throw new Error(`Unknown timeline event: ${type}`)
  const input =
    definition.durability === "durable"
      ? {
          ...base,
          durable: { aggregateID: sessionID, seq: ++durableSequence, version: definition.durable.version },
        }
      : base
  return Schema.decodeUnknownSync(definition)(input) as unknown as OpenCodeEvent
}

function jsonRecord(value: Record<string, unknown> | undefined): Record<string, JsonValue> {
  if (!value) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const next = jsonValue(item)
      return next === undefined ? [] : [[key, next]]
    }),
  )
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map((item) => jsonValue(item) ?? null)
  if (!value || typeof value !== "object") return
  return jsonRecord(value as Record<string, unknown>)
}

function provider() {
  return {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
    ],
    connected: ["opencode"],
    default: { providerID: "opencode", modelID: "claude-opus-4-6" },
  }
}

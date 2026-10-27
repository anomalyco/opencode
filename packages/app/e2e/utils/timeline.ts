import type {
  JsonValue,
  OpenCodeEvent,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageUser,
  SessionStatus,
  SessionStructuredError,
} from "@opencode/client/promise"
import { EventManifest } from "@opencode/schema/event-manifest"
import { SessionMessage } from "@opencode/schema/session-message"
import type { TimelineDetail } from "@opencode/session-ui/timeline/detail"
import { expect, test, type Page, type TestInfo } from "@playwright/test"
import { Schema } from "effect"
import { SERVER, seed, sessionHref } from "./app"
import { mockOpenCodeServer, type MockServerConfig } from "./mock-server"
import { installSseTransport } from "./sse-transport"
import { expectSessionReady } from "./waits"

export const directory = "C:/OpenCode/TimelineStability"

export const projectID = "proj_timeline_stability"

export const sessionID = "ses_timeline_stability"

export const userID = "msg_1000_timeline_user"

export const assistantID = "msg_1001_timeline_assistant"

export const title = "Timeline visual stability"

export const model = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }

const tokens = { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } }

type Session = SessionInfo

type JsonRecord = Record<string, JsonValue | undefined>

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
  metadata?: JsonRecord
  messageID?: string
}

type ToolSeed = {
  id: string
  type: "tool"
  name: string
  messageID?: string
  executed?: boolean
  native?: JsonRecord
  state:
    | { status: "streaming"; input: JsonRecord; raw: string }
    | {
        status: "running"
        input: JsonRecord
        output?: string
        title?: string
        metadata: JsonRecord
        time: { start: number }
      }
    | {
        status: "completed"
        input: JsonRecord
        output: string
        title: string
        metadata: JsonRecord
        time: { start: number; end: number }
      }
    | {
        status: "error"
        input: JsonRecord
        error: string
        metadata: JsonRecord
        time: { start: number; end: number }
      }
}

// Mock server hooks a timeline scenario may add; the fixture owns directory, project, provider, and history.
type TimelineServerInput = Partial<
  Pick<
    MockServerConfig,
    | "inbox"
    | "configEntries"
    | "forms"
    | "permissions"
    | "sessionPermissions"
    | "onPrompt"
    | "onInboxChange"
    | "beforeMessagesResponse"
    | "onMessages"
    | "onMessage"
    | "message"
    | "pageMessages"
    | "onRevertStage"
    | "vcsDiff"
    | "fileList"
    | "fileContent"
    | "findFiles"
    | "pty"
    | "keepalive"
    | "onPermissionReply"
    | "shellCommands"
    | "shellOutput"
  >
>

export type TimelineMessage = SessionMessageUser | SessionMessageAssistant

export type TimelineEvent = OpenCodeEvent | readonly OpenCodeEvent[]

export type EventPayload = OpenCodeEvent

export type ToolStatus = ToolSeed["state"]["status"]

export type PartSeed<Owner extends "user" | "assistant"> = Owner extends "user"
  ? TextSeed | FileSeed | AgentSeed
  : TextSeed | ReasoningSeed | ToolSeed

type ToolOptions<State extends ToolStatus> = State extends "streaming"
  ? { output?: never; title?: never; metadata?: never; error?: never }
  : State extends "running"
    ? { title?: string; metadata?: JsonRecord; output?: string; error?: never }
    : State extends "error"
      ? { error?: string; metadata?: JsonRecord; output?: never; title?: never }
      : { output?: string; title?: string; metadata?: JsonRecord; error?: never }

type PartRef = { messageID: string; type: "text" | "reasoning" | "tool"; ordinal?: number }

type TimelineState = {
  partRefs: Map<string, PartRef>
  nextOrdinals: Map<string, { text: number; reasoning: number }>
  startedParts: Set<string>
  toolStates: Map<string, ToolStatus>
  eventSequence: number
  durableSequence: number
}

// Builder state is owned by the running test attempt. Builders called outside a test (module scope, bun unit tests)
// share the module state, and each test attempt starts from a copy of it.
const moduleState: TimelineState = {
  partRefs: new Map(),
  nextOrdinals: new Map(),
  startedParts: new Set(),
  toolStates: new Map(),
  eventSequence: 0,
  durableSequence: -1,
}

const testStates = new WeakMap<TestInfo, TimelineState>()

function scenario() {
  const info = runningTest()

  if (!info) return moduleState
  const existing = testStates.get(info)

  if (existing) return existing

  const created: TimelineState = {
    partRefs: new Map(moduleState.partRefs),
    nextOrdinals: new Map([...moduleState.nextOrdinals].map(([id, next]) => [id, { ...next }])),
    startedParts: new Set(moduleState.startedParts),
    toolStates: new Map(moduleState.toolStates),
    eventSequence: moduleState.eventSequence,
    durableSequence: moduleState.durableSequence,
  }

  testStates.set(info, created)

  return created
}

function runningTest() {
  // Playwright offers no non-throwing check for a running test.
  try {
    return test.info()
  } catch {
    return undefined
  }
}

export async function setupTimeline(
  page: Page,
  input: {
    messages?: TimelineMessage[]
    sessionMessages?: SessionMessageInfo[]
    sessionStatus?: Record<string, SessionStatus>
    settings?: Record<string, boolean | string | TimelineDetail>
    sessions?: Session[]
    cpuRate?: number
    viewport?: { width: number; height: number }
    eventRetry?: number
    reducedMotion?: boolean
    locale?: string
    deviceScaleFactor?: number
    seedHistory?: boolean
    // Session IDs to open as titlebar tabs.
    tabs?: string[]
  } & TimelineServerInput = {},
) {
  const state = scenario()
  state.eventSequence = 0
  state.durableSequence = -1
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

  const transport = await installSseTransport(page, {
    server: SERVER,
    retry: input.eventRetry ?? 20,
    keepalive: input.keepalive,
  })

  const mock = await mockOpenCodeServer(page, {
    ...input,
    directory,
    project: project(),
    provider: provider(),
    sessions,
    sessionStatus: input.sessionStatus ?? { [sessionID]: initialStatus },
    pageMessages: input.pageMessages ?? (() => ({ items: messages })),
  })

  if (input.tabs) await seed(page, { tabs: input.tabs })
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

  await page.goto(sessionHref(sessionID))
  await expectSessionReady(page, { server: SERVER, sessionID, title })
  await transport.waitForConnection()

  if (input.cpuRate && input.cpuRate > 1) {
    const devtools = await page.context().newCDPSession(page)
    await devtools.send("Emulation.setCPUThrottlingRate", { rate: input.cpuRate })
  }

  // `delay` and `sendAll` pace benchmark workloads only; tests wait for the resulting UI state instead.
  const send = async (input: TimelineEvent, delay = 0) => {
    const events = timelineEvents(input)

    if (events.length === 1) await transport.send(events[0]!, { marker: describeEvent(events[0]!) })

    if (events.length > 1)
      await transport.burst(
        events,
        events.map((item) => ({ marker: describeEvent(item) })),
      )

    if (delay) await page.waitForTimeout(delay)
  }

  return {
    transport,
    pty: mock.pty,
    send,
    async sendAll(sequence: { event: TimelineEvent; delay: number }[]) {
      for (const item of sequence) await send(item.event, item.delay)
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
    return [event.type, "id" in event.data ? event.data.id : undefined].filter(Boolean).join(":")
  }

  return event.type
}

export function event(
  type: "session.status",
  data: Extract<OpenCodeEvent, { type: "session.status" }>["data"],
): OpenCodeEvent {
  return makeEvent(type, data)
}

export function inboxEnqueued(data: Extract<OpenCodeEvent, { type: "session.inbox.enqueued" }>["data"]) {
  return makeEvent("session.inbox.enqueued", data)
}

export function inboxDelivered(data: Extract<OpenCodeEvent, { type: "session.inbox.delivered" }>["data"]) {
  return makeEvent("session.inbox.delivered", data)
}

export function compactionStarted(data: Extract<OpenCodeEvent, { type: "session.compaction.started" }>["data"]) {
  return makeEvent("session.compaction.started", data)
}

export function compactionDelta(data: Extract<OpenCodeEvent, { type: "session.compaction.delta" }>["data"]) {
  return makeEvent("session.compaction.delta", data)
}

export function compactionEnded(data: Extract<OpenCodeEvent, { type: "session.compaction.ended" }>["data"]) {
  return makeEvent("session.compaction.ended", data)
}

export function compactionFailed(data: Extract<OpenCodeEvent, { type: "session.compaction.failed" }>["data"]) {
  return makeEvent("session.compaction.failed", data)
}

export function toolInputStarted(data: Extract<OpenCodeEvent, { type: "session.tool.input.started" }>["data"]) {
  return makeEvent("session.tool.input.started", data)
}

export function toolInputEnded(data: Extract<OpenCodeEvent, { type: "session.tool.input.ended" }>["data"]) {
  return makeEvent("session.tool.input.ended", data)
}

export function toolCalled(data: Extract<OpenCodeEvent, { type: "session.tool.called" }>["data"]) {
  return makeEvent("session.tool.called", data)
}

export function validateTimelineEvent(input: OpenCodeEvent | JsonValue): OpenCodeEvent {
  const header = Schema.decodeUnknownSync(Schema.Struct({ type: Schema.String }))(input)
  const definition = EventManifest.ServerDefinitions.find((definition) => definition.type === header.type)

  if (!definition) throw new Error(`Unknown timeline event: ${header.type}`)

  // SAFETY: the matching canonical event schema validates the payload; OpenCodeEvent is generated from those schemas.
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
      const expected = Schema.is(Schema.String)(message.metadata?.parentID) ? message.metadata.parentID : parentID

      if (!expected || expected !== parentID)
        throw new Error(`Timeline assistant ${message.id} must reference a parent user in the fixture`)
      const refs = scenario().partRefs
      message.content.forEach((part) => {
        if (part.type !== "tool") return

        if (refs.has(part.id) && refs.get(part.id)?.messageID !== message.id)
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
  const startedParts = scenario().startedParts
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

    if (!started && !part.text)
      return [
        makeEvent("session.reasoning.started", {
          sessionID,
          assistantMessageID: messageID,
          ordinal: ref.ordinal!,
          native: jsonRecord(part.metadata),
        }),
      ]

    return [
      ...(started
        ? []
        : [
            makeEvent("session.reasoning.started", {
              sessionID,
              assistantMessageID: messageID,
              ordinal: ref.ordinal!,
              native: jsonRecord(part.metadata),
            }),
          ]),
      makeEvent("session.reasoning.ended", {
        sessionID,
        assistantMessageID: messageID,
        ordinal: ref.ordinal!,
        text: part.text,
        native: jsonRecord(part.metadata),
      }),
    ]
  }

  return toolEvents(part, messageID)
}

export function renderedPartID(partID: string) {
  const ref = scenario().partRefs.get(partID)

  if (!ref || ref.type === "tool") return partID

  return `${ref.messageID}:${ref.type}:${ref.ordinal}`
}

export function partDelta(partID: string, delta: string, messageID = assistantID) {
  const ref = scenario().partRefs.get(partID)

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

export function status(type: SessionStatus["type"], attempt = 1, id = sessionID) {
  if (type === "busy") return makeEvent("session.execution.started", { sessionID: id })

  if (type === "idle") return makeEvent("session.execution.succeeded", { sessionID: id })

  return makeEvent("session.retry.scheduled", {
    sessionID: id,
    assistantMessageID: assistantID,
    attempt,
    at: 1700000010000,
    error: { type: "provider.error", message: "Rate limited" },
  })
}

export function stepStarted(message: SessionMessageAssistant) {
  return makeEvent("session.step.started", {
    sessionID,
    assistantMessageID: message.id,
    agent: message.agent,
    model: message.model,
    started: message.time.created,
  })
}

export function userMessage(
  parts?: PartSeed<"user">[],
  input: { id?: string; summary?: JsonValue; created?: number } = {},
): SessionMessageUser {
  const id = input.id ?? userID
  const seeds = parts ?? [userText("Build the timeline stability matrix.", { id: `prt_${id}_text` })]

  const message: SessionMessageUser = {
    id,
    type: "user",
    time: { created: input.created ?? 1700000000000 },
    text: seeds.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
    files: seeds.flatMap((part) => {
      if (part.type !== "file") return []

      const mention = part.source?.text
        ? { text: part.source.text.value, start: part.source.text.start, end: part.source.text.end }
        : undefined

      const file: NonNullable<SessionMessageUser["files"]>[number] = {
        data: part.url.match(/^data:[^,]*;base64,(.*)$/)?.[1] ?? "",
        mime: part.mime,
        source: part.url.startsWith("data:")
          ? { type: "inline" }
          : { type: "uri", uri: part.source?.path ?? part.url },
      }

      if (part.filename) file.name = part.filename

      if (mention) file.mention = mention

      return [file]
    }),
    agents: seeds.flatMap((part) => {
      if (part.type !== "agent") return []

      const agent: NonNullable<SessionMessageUser["agents"]>[number] = { name: part.name }

      if (part.source)
        agent.mention = { text: part.source.value, start: part.source.start, end: part.source.end }

      return [agent]
    }),
  }

  if (input.summary !== undefined) message.metadata = { summary: input.summary }

  return message
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
  if (input.error) Schema.decodeUnknownSync(SessionMessage.Assistant.fields.error)(input.error)
  const id = input.id ?? assistantID
  const created = input.created ?? 1700000001000
  const ordinals = { text: 0, reasoning: 0 }
  const content = parts.map((part) => messageContent(part, id, ordinals))
  scenario().nextOrdinals.set(id, ordinals)

  const message: SessionMessageAssistant = {
    id,
    type: "assistant",
    metadata: { parentID: input.parentID ?? userID },
    time: { created },
    model: { id: model.modelID, providerID: model.providerID, variant: model.variant },
    agent: "build",
    content,
    cost: 0.01,
    tokens,
  }

  if (input.completed !== false) {
    message.time.completed = created + 1_000
    message.finish = "stop"
  }

  if (input.error) message.error = input.error

  return message
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
  state: "streaming",
  input: JsonRecord,
  options?: ToolOptions<"streaming">,
): ToolSeed
export function toolPart(
  id: string,
  tool: string,
  state: "running",
  input: JsonRecord,
  options?: ToolOptions<"running">,
): ToolSeed
export function toolPart(
  id: string,
  tool: string,
  state: "completed",
  input: JsonRecord,
  options?: ToolOptions<"completed">,
): ToolSeed
export function toolPart(
  id: string,
  tool: string,
  state: "error",
  input: JsonRecord,
  options?: ToolOptions<"error">,
): ToolSeed
export function toolPart(
  id: string,
  tool: string,
  state: ToolStatus,
  input: JsonRecord,
  options: ToolOptions<ToolStatus> = {},
): ToolSeed {
  const base = { id, type: "tool" as const, name: tool }

  if (state === "streaming") return { ...base, state: { status: state, input, raw: "" } }

  if (state === "running")
    return {
      ...base,
      state: {
        status: state,
        input,
        output: options.output,
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
  if (state === "streaming") return toolPart(id, "shell", state, { command })

  if (state === "running") return toolPart(id, "shell", state, { command }, { title: command, output })

  if (state === "error") return toolPart(id, "shell", state, { command }, { error: output || undefined })

  return toolPart(id, "shell", state, { command }, { title: command, output })
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
  const owner = scenario()

  if (part.type === "tool") {
    owner.partRefs.set(part.id, { messageID, type: part.type })
    owner.toolStates.set(part.id, part.state.status)
  } else {
    owner.partRefs.set(part.id, { messageID, type: part.type, ordinal: ordinals[part.type]++ })
    owner.startedParts.add(part.id)
  }

  if (part.type === "text") return { type: "text", text: part.text }

  if (part.type === "reasoning") {
    const content: Extract<SessionMessageAssistant["content"][number], { type: "reasoning" }> = {
      type: "reasoning",
      text: part.text,
      native: jsonRecord(part.metadata),
    }

    if (part.time) {
      content.time = { created: part.time.start }

      if (part.time.end !== undefined) content.time.completed = part.time.end
    }

    return content
  }

  const state = part.state
  const time = "time" in state ? state.time : undefined
  const completed = state.status === "completed" || state.status === "error" ? state.time.end : undefined

  const base: Omit<Extract<SessionMessageAssistant["content"][number], { type: "tool" }>, "state"> = {
    type: "tool",
    id: part.id,
    name: part.name,
    time: {
      created: time?.start ?? 1700000001000,
    },
  }

  if (time?.start !== undefined) base.time.ran = time.start

  if (completed !== undefined) base.time.completed = completed

  if (part.executed !== undefined) base.executed = part.executed

  if (part.native) base.native = jsonRecord(part.native)

  if (state.status === "streaming") return { ...base, state: { status: "streaming", input: state.raw } }

  if (state.status === "running") {
    const metadata = { ...state.metadata }

    if (state.output !== undefined) metadata.output = state.output

    return {
      ...base,
      state: {
        status: "running",
        input: jsonRecord(state.input),
        metadata: jsonRecord(metadata),
      },
    }
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
  const toolStates = scenario().toolStates
  const previous = toolStates.get(part.id)

  if (previous === "completed" || previous === "error") return []

  const events: OpenCodeEvent[] = []

  if (!previous) {
    events.push(
      makeEvent("session.tool.input.started", {
        sessionID,
        assistantMessageID: messageID,
        id: part.id,
        name: part.name,
      }),
    )
  }

  if (part.state.status === "streaming") {
    toolStates.set(part.id, part.state.status)

    return events
  }

  if (!previous || previous === "streaming") {
    events.push(
      makeEvent("session.tool.input.ended", {
        sessionID,
        assistantMessageID: messageID,
        id: part.id,
        text: JSON.stringify(part.state.input),
      }),
      makeEvent("session.tool.called", {
        sessionID,
        assistantMessageID: messageID,
        id: part.id,
        input: part.state.input,
        executed: part.executed ?? true,
        native: jsonRecord(part.native),
      }),
    )
  }

  if (part.state.status === "running") {
    const metadata = {
      ...part.state.metadata,
    }

    if (part.state.output !== undefined) metadata.output = part.state.output

    if (previous === "running" || Object.keys(metadata).length)
      events.push(
        makeEvent("session.tool.progress", {
          sessionID,
          assistantMessageID: messageID,
          id: part.id,
          metadata: jsonRecord(metadata),
        }),
      )
    toolStates.set(part.id, part.state.status)

    return events
  }

  if (part.state.status === "error") {
    events.push(
      makeEvent("session.tool.failed", {
        sessionID,
        assistantMessageID: messageID,
        id: part.id,
        error: { type: "ToolError", message: part.state.error },
        metadata: jsonRecord(part.state.metadata),
        executed: part.executed ?? true,
      }),
    )
    toolStates.set(part.id, part.state.status)

    return events
  }

  events.push(
    makeEvent("session.tool.success", {
      sessionID,
      assistantMessageID: messageID,
      id: part.id,
      content: [{ type: "text", text: part.state.output }],
      metadata: jsonRecord(part.state.metadata),
      executed: part.executed ?? true,
    }),
  )
  toolStates.set(part.id, part.state.status)

  return events
}

function partRef(id: string, messageID: string, type: PartRef["type"]): PartRef {
  const state = scenario()
  const current = state.partRefs.get(id)

  if (current) return current

  if (type === "tool") {
    const ref = { messageID, type } satisfies PartRef
    state.partRefs.set(id, ref)

    return ref
  }

  const next = state.nextOrdinals.get(messageID) ?? { text: 0, reasoning: 0 }
  const ref = { messageID, type, ordinal: next[type]++ } satisfies PartRef
  state.nextOrdinals.set(messageID, next)
  state.partRefs.set(id, ref)

  return ref
}

function makeEvent<Type extends OpenCodeEvent["type"]>(
  type: Type,
  data: Extract<OpenCodeEvent, { type: Type }>["data"],
): OpenCodeEvent {
  const state = scenario()
  const sequence = ++state.eventSequence
  const id = `evt_timeline_${String(sequence).padStart(4, "0")}`
  const base = { id, created: 1700000002000 + sequence, type, data, location: { directory } }
  const definition = EventManifest.ServerDefinitions.find((definition) => definition.type === type)

  if (!definition) throw new Error(`Unknown timeline event: ${type}`)

  const input =
    definition.durability === "durable"
      ? {
          ...base,
          durable: { aggregateID: sessionID, seq: ++state.durableSequence, version: definition.durable.version },
        }
      : base

  // SAFETY: the matching canonical event schema validates the payload; OpenCodeEvent is generated from those schemas.
  return Schema.decodeUnknownSync(definition)(input) as OpenCodeEvent
}

const decodeJsonRecord = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.MutableJson)))

function jsonRecord(value: JsonRecord | undefined): Record<string, JsonValue> {
  if (!value) return {}

  return decodeJsonRecord(JSON.stringify(value))
}

function provider() {
  return {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
      {
        id: "company-gateway",
        name: "Company Gateway",
        models: {
          "fast-nano": {
            id: "fast-nano",
            api: { id: "openai/gpt-5.4-nano" },
            name: "GPT-5.4 nano",
            limit: { context: 128_000 },
          },
          "long-context": {
            id: "long-context",
            api: { id: "company/long-context" },
            name: "Company Gateway Extra Long Context Model for Narrow Timeline Layouts",
            limit: { context: 128_000 },
          },
        },
      },
    ],
    connected: ["opencode", "company-gateway"],
    default: { providerID: "opencode", modelID: "claude-opus-4-6" },
  }
}

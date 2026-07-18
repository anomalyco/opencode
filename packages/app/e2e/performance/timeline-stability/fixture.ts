import { base64Encode } from "@opencode-ai/core/util/encode"
import { Event } from "@opencode-ai/schema/event"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"
import { SessionV1 } from "@opencode-ai/schema/session-v1"
import type {
  AssistantMessage,
  GlobalEvent,
  Message,
  Part,
  Session,
  SessionStatus,
  ToolPart,
  ToolState,
  UserMessage,
} from "@opencode-ai/sdk/v2/client"
import { expect, type Page } from "@playwright/test"
import { Schema } from "effect"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { installSseTransport } from "../../utils/sse-transport"
import { expectSessionTitle } from "../../utils/waits"

export const directory = "C:/OpenCode/TimelineStability"
export const projectID = "proj_timeline_stability"
export const sessionID = "ses_timeline_stability"
export const userID = "msg_1000_timeline_user"
export const assistantID = "msg_1001_timeline_assistant"
export const title = "Timeline visual stability"
export const model = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }

type TimelinePayload = Extract<
  GlobalEvent["payload"],
  {
    type:
      | "message.updated"
      | "message.removed"
      | "message.part.updated"
      | "message.part.removed"
      | "message.part.delta"
      | "session.status"
  }
>

type DeepReadonly<Value> = Value extends readonly unknown[]
  ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
  : Value extends object
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value

export type TimelineEvent = DeepReadonly<Omit<GlobalEvent, "payload"> & { payload: TimelinePayload }>
export type EventPayload = TimelineEvent
export type ToolStatus = ToolState["status"]
export type TimelineMessage = { info: UserMessage; parts: Part[] } | { info: AssistantMessage; parts: Part[] }

type UserPart = Extract<Part, { type: "text" | "file" | "agent" | "subtask" }>
type AssistantPart = Exclude<Part, { type: "agent" | "subtask" }>
type OwnedPart<Owner extends Message["role"]> = Owner extends "user" ? UserPart : AssistantPart
export type PartSeed<Owner extends Message["role"]> =
  OwnedPart<Owner> extends infer Candidate
    ? Candidate extends Part
      ? Omit<Candidate, "sessionID" | "messageID">
      : never
    : never

type ToolOptions<State extends ToolStatus> = State extends "pending"
  ? { output?: never; title?: never; metadata?: never; error?: never }
  : State extends "running"
    ? { title?: string; metadata?: Record<string, unknown>; output?: never; error?: never }
    : State extends "error"
      ? { error?: string; metadata?: Record<string, unknown>; output?: never; title?: never }
      : { output?: string; title?: string; metadata?: Record<string, unknown>; error?: never }

const decodeOptions = { errors: "all", onExcessProperty: "error" } as const
const decodeMessage = Schema.decodeUnknownSync(SessionV1.WithParts)
const decodePart = Schema.decodeUnknownSync(SessionV1.Part)
const decodeStatus = Schema.decodeUnknownSync(SessionStatusEvent.Info)
const timelineEventSchema = Schema.Union([
  eventSchema("message.updated", SessionV1.Event.MessageUpdated.data),
  eventSchema("message.removed", SessionV1.Event.MessageRemoved.data),
  eventSchema("message.part.updated", SessionV1.Event.PartUpdated.data),
  eventSchema("message.part.removed", SessionV1.Event.PartRemoved.data),
  eventSchema("message.part.delta", SessionV1.Event.PartDelta.data),
  eventSchema("session.status", SessionStatusEvent.Status.data),
])
const decodeEvent = Schema.decodeUnknownSync(timelineEventSchema)
let eventSequence = 0

export async function setupTimeline(
  page: Page,
  input: {
    messages?: TimelineMessage[]
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
  const sessions = input.sessions ?? [session()]
  const messages = validateTimelineMessages([
    ...(input.seedHistory ? historyMessages(18) : []),
    ...(input.messages ?? [userMessage(), assistantMessage()]),
  ])
  const active = messages.findLast((message) => message.info.role === "assistant")
  const initialStatus = decodeStatus(
    active?.info.role === "assistant" && active.info.time.completed === undefined ? { type: "busy" } : { type: "idle" },
    decodeOptions,
  )
  const transport = await installSseTransport<EventPayload>(page, {
    server: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
    retry: input.eventRetry ?? 20,
  })
  await mockOpenCodeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions,
    sessionStatus: { [sessionID]: initialStatus },
    pageMessages: () => ({
      items: messages,
    }),
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
    if (settings.newLayoutDesigns === false) {
      localStorage.setItem("app-version.v1", JSON.stringify({ version: "1.17.20" }))
    }
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
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await transport.waitForConnection()
  await expectSessionTitle(page, title)
  if (input.cpuRate && input.cpuRate > 1) {
    const devtools = await page.context().newCDPSession(page)
    await devtools.send("Emulation.setCPUThrottlingRate", { rate: input.cpuRate })
  }

  return {
    transport,
    async send(event: TimelineEvent, delay = 0) {
      const valid = validateTimelineEvent(event)
      await transport.send(valid, { marker: describeEvent(valid) })
      if (delay) await page.waitForTimeout(delay)
    },
    async sendAll(sequence: { event: TimelineEvent; delay: number }[]) {
      for (const item of sequence) {
        const valid = validateTimelineEvent(item.event)
        await transport.send(valid, { marker: describeEvent(valid) })
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
      await expect(page.locator(`[data-timeline-part-id="${partID}"]`).first()).toBeVisible()
    },
  }
}

function describeEvent(event: EventPayload) {
  if (event.payload.type === "message.part.updated") {
    const part = event.payload.properties.part
    return [
      event.payload.type,
      part.id,
      part.type === "tool" ? part.tool : part.type,
      part.type === "tool" ? part.state.status : undefined,
    ]
      .filter(Boolean)
      .join(":")
  }
  if (event.payload.type === "session.status") {
    const status = event.payload.properties.status
    return [event.payload.type, status.type, status.type === "retry" ? status.attempt : undefined]
      .filter((value) => value !== undefined)
      .join(":")
  }
  return event.payload.type
}

export function event<const Type extends TimelinePayload["type"]>(
  type: Type,
  properties: Extract<TimelinePayload, { type: Type }>["properties"],
): TimelineEvent
export function event(type: TimelinePayload["type"], properties: TimelinePayload["properties"]): TimelineEvent {
  return validateTimelineEvent({
    directory,
    payload: { id: `evt_timeline_${String(++eventSequence).padStart(4, "0")}`, type, properties },
  })
}

export function validateTimelineEvent(input: unknown): TimelineEvent {
  return decodeEvent(input, decodeOptions)
}

export function validateTimelineMessages(input: readonly TimelineMessage[]): TimelineMessage[] {
  input.forEach((message) => decodeMessage(message, decodeOptions))
  const messages = [...input]
  const messageIDs = new Set<string>()
  const partIDs = new Set<string>()
  const users = new Set(messages.filter((message) => message.info.role === "user").map((message) => message.info.id))

  messages.forEach((message) => {
    if (messageIDs.has(message.info.id))
      throw new Error(`Timeline fixture has duplicate message ID: ${message.info.id}`)
    messageIDs.add(message.info.id)
    if (message.info.role === "assistant" && !users.has(message.info.parentID))
      throw new Error(`Timeline assistant ${message.info.id} must reference a parent user in the fixture`)
    message.parts.forEach((part) => {
      if (part.sessionID !== message.info.sessionID || part.messageID !== message.info.id)
        throw new Error(`Timeline part ${part.id} ownership does not match message ${message.info.id}`)
      if (message.info.role === "user" && !["text", "file", "agent", "subtask"].includes(part.type))
        throw new Error(`Timeline user message ${message.info.id} cannot own ${part.type} part ${part.id}`)
      if (message.info.role === "assistant" && ["agent", "subtask"].includes(part.type))
        throw new Error(`Timeline assistant message ${message.info.id} cannot own ${part.type} part ${part.id}`)
      if (partIDs.has(part.id)) throw new Error(`Timeline fixture has duplicate part ID: ${part.id}`)
      partIDs.add(part.id)
    })
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

export function partUpdated(part: Part | PartSeed<"assistant">) {
  const owned = "messageID" in part ? part : { ...part, sessionID, messageID: assistantID }
  decodePart(owned, decodeOptions)
  return event("message.part.updated", {
    sessionID,
    part: owned,
    time: 1700000002000,
  })
}

export function partDelta(partID: string, delta: string, messageID = assistantID) {
  return event("message.part.delta", { sessionID, messageID, partID, field: "text", delta })
}

export function messageUpdated(info: Message) {
  return event("message.updated", { sessionID, info })
}

export function status(type: SessionStatus["type"], attempt = 1) {
  return event("session.status", {
    sessionID,
    status: type === "retry" ? { type, attempt, message: "Rate limited", next: 1700000010000 } : { type },
  })
}

export function userMessage(
  parts?: PartSeed<"user">[],
  input: { id?: string; summary?: UserMessage["summary"]; created?: number } = {},
): Extract<TimelineMessage, { info: { role: "user" } }> {
  const id = input.id ?? userID
  const seeds = parts ?? [userText("Build the timeline stability matrix.", { id: `prt_${id}_text` })]
  const message = {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: input.created ?? 1700000000000 },
      summary: input.summary ?? { diffs: [] },
      agent: "build",
      model,
    },
    parts: seeds.map((part) => ({
      ...part,
      sessionID,
      messageID: id,
    })),
  } satisfies Extract<TimelineMessage, { info: { role: "user" } }>
  decodeMessage(message, decodeOptions)
  return message
}

export function assistantMessage(
  parts: PartSeed<"assistant">[] = [],
  input: {
    id?: string
    parentID?: string
    completed?: boolean
    error?: AssistantMessage["error"]
    created?: number
  } = {},
): Extract<TimelineMessage, { info: { role: "assistant" } }> {
  const id = input.id ?? assistantID
  const message = {
    info: {
      id,
      sessionID,
      role: "assistant",
      time: {
        created: input.created ?? 1700000001000,
        ...(input.completed === false ? {} : { completed: (input.created ?? 1700000001000) + 1_000 }),
      },
      parentID: input.parentID ?? userID,
      modelID: model.modelID,
      providerID: model.providerID,
      mode: "build",
      agent: "build",
      path: { cwd: directory, root: directory },
      cost: 0.01,
      tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
      variant: "max",
      ...(input.error ? { error: input.error } : {}),
    },
    parts: parts.map((part) => ({ ...part, sessionID, messageID: id })),
  } satisfies Extract<TimelineMessage, { info: { role: "assistant" } }>
  decodeMessage(message, decodeOptions)
  return message
}

export function userText(
  text: string,
  input: Partial<Omit<Extract<PartSeed<"user">, { type: "text" }>, "type" | "text">> = {},
): Extract<PartSeed<"user">, { type: "text" }> {
  return { id: "prt_user_text", type: "text", text, ...input }
}

export function textPart(id: string, text: string): Extract<PartSeed<"assistant">, { type: "text" }> {
  return { id, type: "text", text }
}

export function reasoningPart(id: string, text: string): Extract<PartSeed<"assistant">, { type: "reasoning" }> {
  return { id, type: "reasoning", text, time: { start: 1700000001000 } }
}

export function toolPart(
  id: string,
  tool: string,
  state: "pending",
  input: Record<string, unknown>,
  options?: ToolOptions<"pending">,
): Omit<ToolPart, "sessionID" | "messageID">
export function toolPart(
  id: string,
  tool: string,
  state: "running",
  input: Record<string, unknown>,
  options?: ToolOptions<"running">,
): Omit<ToolPart, "sessionID" | "messageID">
export function toolPart(
  id: string,
  tool: string,
  state: "completed",
  input: Record<string, unknown>,
  options?: ToolOptions<"completed">,
): Omit<ToolPart, "sessionID" | "messageID">
export function toolPart(
  id: string,
  tool: string,
  state: "error",
  input: Record<string, unknown>,
  options?: ToolOptions<"error">,
): Omit<ToolPart, "sessionID" | "messageID">
export function toolPart(
  id: string,
  tool: string,
  state: ToolStatus,
  input: Record<string, unknown>,
  options: ToolOptions<ToolStatus> = {},
): Omit<ToolPart, "sessionID" | "messageID"> {
  const base = { id, type: "tool" as const, callID: `call_${id}`, tool }
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

export function shell(
  id: string,
  state: ToolStatus,
  output = "",
  command = `echo ${id}`,
): Omit<ToolPart, "sessionID" | "messageID"> {
  if (state === "pending") return toolPart(id, "bash", state, { command })
  if (state === "running")
    return toolPart(id, "bash", state, { command }, { title: command, metadata: { command, output } })
  if (state === "error")
    return toolPart(id, "bash", state, { command }, { error: output || undefined, metadata: { command, output } })
  return toolPart(id, "bash", state, { command }, { title: command, output, metadata: { command, output } })
}

export function completedAssistantInfo(info: AssistantMessage): AssistantMessage {
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
    slug: "timeline-stability",
    projectID,
    directory,
    title,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
    ...input,
  }
}

function eventSchema<
  const Type extends TimelinePayload["type"],
  const Properties extends Schema.Codec<unknown, unknown>,
>(type: Type, properties: Properties) {
  return Schema.Struct({
    directory: Schema.String,
    project: Schema.optional(Schema.String),
    workspace: Schema.optional(Schema.String),
    payload: Schema.Struct({ id: Event.ID, type: Schema.Literal(type), properties }),
  })
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

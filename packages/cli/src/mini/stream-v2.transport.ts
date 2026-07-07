import type { EventSubscribeOutput, OpenCodeClient } from "@opencode-ai/client/promise"
import type {
  PermissionRequest,
  QuestionRequest,
  SessionMessageInfo,
  SessionMessageAssistantTool,
} from "@opencode-ai/sdk/v2"
import { Event } from "@opencode-ai/schema/event"
import { blockerStatus, pickBlockerView } from "./session-data"
import { writeSessionOutput } from "./stream"
import { createSubagentTracker, legacyTool, toolCommit } from "./stream-v2.subagent"
import type {
  FooterApi,
  FooterView,
  LocalReplayAnchor,
  LocalReplayRow,
  RunFilePart,
  RunInput,
  RunPrompt,
  RunPromptPart,
  RunProvider,
  StreamCommit,
} from "./types"

type Trace = {
  write(type: string, data?: unknown): void
}

type StreamInput = {
  sdk: OpenCodeClient
  directory?: string
  sessionID: string
  thinking: boolean
  replay?: boolean
  replayLimit?: number
  limits: () => Record<string, number>
  providers?: () => RunProvider[]
  footer: FooterApi
  trace?: Trace
  signal?: AbortSignal
  onCatalogRefresh?: () => void
}

export type SessionTurnInput = {
  agent: string | undefined
  model: RunInput["model"]
  variant: string | undefined
  prompt: RunPrompt
  files: RunFilePart[]
  includeFiles: boolean
  onVisibleOutput?: (anchor: LocalReplayAnchor) => void
  signal?: AbortSignal
}

export type SessionResizeReplayInput = {
  localRows: () => LocalReplayRow[]
  reset: () => Promise<void>
}

export type SessionTransport = {
  runPromptTurn(input: SessionTurnInput): Promise<void>
  interruptActiveTurn(): Promise<void>
  selectSubagent(sessionID: string | undefined): void
  replayOnResize(input: SessionResizeReplayInput): Promise<boolean>
  close(): Promise<void>
}

type Wait = {
  messageID: string
  promoted: boolean
  interrupted: boolean
  failureRendered: boolean
  resolve: () => void
  reject: (error: unknown) => void
  onVisibleOutput?: (anchor: LocalReplayAnchor) => void
}

// One active session.shell call. The HTTP response is the completion signal;
// callID correlates the live shell events once shell.started is observed, and
// abort cancels the blocking request when the user interrupts the turn.
type ShellWait = {
  eventID: string
  messageID: string
  callID?: string
  resolve: () => void
  abort: () => void
}

type RunV2Event = EventSubscribeOutput
type PermissionV2Request = Extract<RunV2Event, { type: "permission.v2.asked" }>["data"]
type QuestionV2Request = Extract<RunV2Event, { type: "question.v2.asked" }>["data"]
type PromptFilePart = Extract<RunPromptPart, { type: "file" }>

type ToolState = {
  messageID: string
  name: string
  input: Record<string, unknown>
  started: number
  running: boolean
  providerState?: Record<string, unknown>
}

type State = {
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  view: FooterView
  messageIDs: Set<string>
  text: Map<string, string>
  projectedText: Map<string, string>
  reasoning: Map<string, string>
  projectedReasoning: Map<string, string>
  tools: Map<string, ToolState>
  finishedTools: Set<string>
  skillMessages: Set<string>
  shellCommands: Map<string, string>
  shellStarted: Set<string>
  shellEnded: Set<string>
  shellWait?: ShellWait
  wait?: Wait
  connected: boolean
  closed: boolean
  initial: boolean
  buffered?: RunV2Event[]
  errors: Set<string>
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export function formatUnknownError(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message || error.name
  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message")
    if (typeof message === "string" && message.trim()) return message
    const tag = Reflect.get(error, "_tag")
    if (typeof tag === "string" && tag.trim()) return tag
  }
  return "unknown error"
}

function permission(request: PermissionV2Request): PermissionRequest {
  return {
    id: request.id,
    sessionID: request.sessionID,
    permission: request.action,
    patterns: [...request.resources],
    metadata: request.metadata ?? {},
    always: [...(request.save ?? [])],
    tool: request.source?.type === "tool" ? request.source : undefined,
  }
}

function question(request: QuestionV2Request): QuestionRequest {
  return {
    id: request.id,
    sessionID: request.sessionID,
    questions: request.questions.map((item) => ({ ...item, options: item.options.map((option) => ({ ...option })) })),
    tool: request.tool,
  }
}

function sessionID(event: RunV2Event) {
  return "sessionID" in event.data && typeof event.data.sessionID === "string" ? event.data.sessionID : undefined
}

function errorMessage(error: { message?: string; _tag?: string }) {
  return error.message || error._tag || "Session execution failed"
}

function wait(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, delay)
    signal.addEventListener("abort", done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
  })
}

async function prepareFile(file: RunFilePart) {
  if (file.mime !== "text/plain") return { attachment: { uri: file.url, name: file.filename } }
  const content = file.url.startsWith("data:")
    ? Buffer.from(file.url.slice(file.url.indexOf(",") + 1), "base64").toString("utf8")
    : await Bun.file(new URL(file.url)).text()
  return { text: `<file name="${file.filename}">\n${content}\n</file>` }
}

function promptFileMention(part: PromptFilePart) {
  if (!part.source?.text) return
  return {
    start: part.source.text.start,
    end: part.source.text.end,
    text: part.source.text.value,
  }
}

function promptFiles(next: SessionTurnInput) {
  return next.prompt.parts.flatMap((part) =>
    part.type === "file"
      ? [
          {
            uri: part.url,
            name: part.filename,
            mention: promptFileMention(part),
          },
        ]
      : [],
  )
}

function promptAgents(next: SessionTurnInput) {
  return next.prompt.parts.flatMap((part) =>
    part.type === "agent"
      ? [
          {
            name: part.name,
            mention: part.source
              ? { start: part.source.start, end: part.source.end, text: part.source.value }
              : undefined,
          },
        ]
      : [],
  )
}

function streamPartKey(messageID: string, partID: string) {
  return `${messageID}\u0000${partID}`
}

// Matches the commit shapes the legacy session-data reducer produced for direct
// shell calls: one "start" commit rendering `$ command` and one "progress"
// commit rendering the merged output (see toolEntryBody in tool.ts).
function shellCommit(
  callID: string,
  command: string,
  next: Pick<StreamCommit, "text" | "phase" | "toolState" | "toolError">,
): StreamCommit {
  return {
    kind: "tool",
    source: "tool",
    partID: `shell:${callID}`,
    tool: "bash",
    shell: { callID, command },
    ...next,
  }
}

function shellTerminal(
  callID: string,
  command: string,
  shell: { status: string; exit?: number | string },
  output: { output: string; cursor: number; size: number; truncated: boolean },
) {
  const incomplete = output.truncated || output.cursor < output.size
  const text = `${output.output}${incomplete ? `${output.output.endsWith("\n") || !output.output ? "" : "\n"}[output truncated]` : ""}`
  const error =
    shell.status === "exited" && shell.exit === 0
      ? undefined
      : shell.status === "exited"
        ? `Shell exited with code ${shell.exit ?? "unknown"}`
        : `Shell ${shell.status}`
  if (!error) return [shellCommit(callID, command, { text, phase: "progress", toolState: "completed" })]
  return [
    ...(text ? [shellCommit(callID, command, { text, phase: "progress", toolState: "running" })] : []),
    shellCommit(callID, command, { text: error, phase: "final", toolState: "error", toolError: error }),
  ]
}

function messageIDFromEvent(id: string) {
  return id.replace(/^evt_/, "msg_")
}

const catalogEvents = new Set([
  "catalog.updated",
  "integration.updated",
  "agent.updated",
  "command.updated",
  "skill.updated",
  "reference.updated",
])

// session.shell resolves after the command settled server-side; the matching
// live shell.ended event usually lands within the same tick, but hold the turn
// briefly so the output commit renders inside it.
const SHELL_OUTPUT_GRACE_MS = 1500

function skillCommit(messageID: string, name: string): StreamCommit {
  return {
    kind: "system",
    source: "system",
    messageID,
    partID: `skill:${messageID}`,
    text: `→ Skill "${name}"`,
    phase: "start",
  }
}

async function resolveSelectedModel(input: StreamInput, next: Pick<SessionTurnInput, "model" | "variant" | "signal">) {
  if (next.model) return { providerID: next.model.providerID, id: next.model.modelID, variant: next.variant }
  if (!next.variant) return

  const session = await input.sdk.session
    .get({ sessionID: input.sessionID }, { signal: next.signal })
    .then((response) => response.model)
  if (session) return { ...session, variant: next.variant }

  const fallback = await input.sdk.model.default(undefined, { signal: next.signal }).then((response) => response.data)
  if (!fallback) return
  return { providerID: fallback.providerID, id: fallback.id, variant: next.variant }
}

export async function createSessionTransport(input: StreamInput): Promise<SessionTransport> {
  const controller = new AbortController()
  input.signal?.addEventListener("abort", () => controller.abort(), { once: true })
  const state: State = {
    permissions: [],
    questions: [],
    view: { type: "prompt" },
    messageIDs: new Set(),
    text: new Map(),
    projectedText: new Map(),
    reasoning: new Map(),
    projectedReasoning: new Map(),
    tools: new Map(),
    finishedTools: new Set(),
    skillMessages: new Set(),
    shellCommands: new Map(),
    shellStarted: new Set(),
    shellEnded: new Set(),
    connected: false,
    closed: false,
    initial: true,
    errors: new Set(),
  }
  let readyResolve!: () => void
  let readyReject!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const abortReady = () => readyReject(new Error("Mini closed before the event stream connected"))
  controller.signal.addEventListener("abort", abortReady, { once: true })
  const offFooterClose = input.footer.onClose(() => controller.abort())

  const subagents = createSubagentTracker({
    sdk: input.sdk,
    sessionID: input.sessionID,
    thinking: input.thinking,
    emit: () => {
      if (state.closed || input.footer.isClosed) return
      writeSessionOutput(
        { footer: input.footer, trace: input.trace },
        { commits: [], footer: { subagent: subagents.snapshot() } },
      )
    },
  })

  const write = (commits: StreamCommit[], patch?: { phase?: "idle" | "running"; status?: string; usage?: string }) => {
    const visible = commits.at(-1)
    if (visible) {
      state.wait?.onVisibleOutput?.({
        kind: visible.kind,
        text: visible.text,
        phase: visible.phase,
        messageID: visible.messageID,
        partID: visible.partID,
        toolState: visible.toolState,
      })
    }
    writeSessionOutput({ footer: input.footer, trace: input.trace }, { commits, footer: patch ? { patch } : undefined })
  }

  const syncBlockers = () => {
    const next = pickBlockerView({ permission: state.permissions[0], question: state.questions[0] })
    if (next.type === "prompt" && state.view.type === "prompt") return
    if (next.type !== "prompt" && state.view.type === next.type && next.request.id === state.view.request.id) return
    state.view = next
    writeSessionOutput(
      { footer: input.footer, trace: input.trace },
      { commits: [], footer: { view: next, patch: { status: blockerStatus(next) } } },
    )
  }

  const renderTool = (messageID: string, item: SessionMessageAssistantTool) => {
    const part = legacyTool({
      sessionID: input.sessionID,
      messageID,
      tool: item,
    })
    if (item.state.status === "streaming") return
    if (item.state.status === "running") {
      if (state.tools.get(item.id)?.running) return
      state.tools.set(item.id, {
        messageID,
        name: item.name,
        input: item.state.input,
        started: item.time.ran ?? item.time.created,
        running: true,
        providerState: item.providerState,
      })
      write([toolCommit(part, "start")], { phase: "running", status: `running ${item.name}` })
      return
    }
    if (state.finishedTools.has(item.id)) return
    if (!state.tools.get(item.id)?.running) write([toolCommit(part, "start")])
    state.finishedTools.add(item.id)
    state.tools.delete(item.id)
    write([
      toolCommit(
        part,
        item.state.status === "completed" && part.state.status === "completed" && part.state.output
          ? "progress"
          : "final",
      ),
    ])
  }

  const renderMessage = (message: SessionMessageInfo, render: boolean, reuseVisibleWait: boolean) => {
    if (message.type === "user") {
      const waiting = state.wait?.messageID === message.id
      if (waiting && state.wait) state.wait.promoted = true
      if (!render || state.messageIDs.has(message.id)) return
      state.messageIDs.add(message.id)
      if (reuseVisibleWait && waiting) return
      write([{ kind: "user", source: "system", text: message.text, phase: "start", messageID: message.id }])
      return
    }
    if (message.type === "skill") {
      if (state.wait?.messageID === message.id) state.wait.promoted = true
      if (!render || state.skillMessages.has(message.id)) {
        state.skillMessages.add(message.id)
        return
      }
      state.skillMessages.add(message.id)
      write([skillCommit(message.id, message.name)])
      return
    }
    if (message.type === "shell") {
      state.shellCommands.set(message.shellID, message.command)
      if (state.shellWait?.messageID === message.id) state.shellWait.callID = message.shellID
      const completed = message.time.completed !== undefined
      if (!render) {
        // Suppressed history: mark settled shells rendered so live redelivery
        // stays silent. A still-running shell stays unmarked and renders in
        // full when its live shell.ended event arrives.
        if (completed) {
          state.shellStarted.add(message.shellID)
          state.shellEnded.add(message.shellID)
        }
        return
      }
      if (!state.shellStarted.has(message.shellID)) {
        state.shellStarted.add(message.shellID)
        write([
          shellCommit(message.shellID, message.command, {
            text: "running shell",
            phase: "start",
            toolState: "running",
          }),
        ])
      }
      if (completed && message.output && !state.shellEnded.has(message.shellID)) {
        state.shellEnded.add(message.shellID)
        write(shellTerminal(message.shellID, message.command, message, message.output))
      }
      if (completed && state.shellWait?.callID === message.shellID) state.shellWait.resolve()
      return
    }
    if (message.type !== "assistant") return
    state.messageIDs.add(message.id)
    let textOrdinal = 0
    let reasoningOrdinal = 0
    for (const item of message.content) {
      if (item.type === "text") {
        const id = `text:${textOrdinal++}`
        const key = streamPartKey(message.id, id)
        const sent = state.text.get(key)?.length ?? 0
        state.text.set(key, item.text)
        if (render) state.projectedText.set(key, item.text)
        if (render && item.text.length > sent)
          write([
            {
              kind: "assistant",
              source: "assistant",
              text: item.text.slice(sent),
              phase: "progress",
              messageID: message.id,
              partID: id,
            },
          ])
        continue
      }
      if (item.type === "reasoning") {
        const id = `reasoning:${reasoningOrdinal++}`
        const key = streamPartKey(message.id, id)
        const sent = state.reasoning.get(key)?.length ?? 0
        state.reasoning.set(key, item.text)
        if (render) state.projectedReasoning.set(key, item.text)
        if (render && input.thinking && item.text.length > sent)
          write([
            {
              kind: "reasoning",
              source: "reasoning",
              text: sent === 0 ? `Thinking: ${item.text}` : item.text.slice(sent),
              phase: "progress",
              messageID: message.id,
              partID: id,
            },
          ])
        continue
      }
      if (render) renderTool(message.id, item)
    }
    if (render && message.error && !state.errors.has(message.id)) {
      state.errors.add(message.id)
      write([
        {
          kind: "error",
          source: "system",
          text: errorMessage(message.error),
          phase: "start",
          messageID: message.id,
        },
      ])
    }
  }

  const hydrate = async (next: { render: boolean; reuseVisibleWait: boolean }) => {
    const [messages, permissions, questions, active] = await Promise.all([
      input.sdk.message.list({ sessionID: input.sessionID, limit: input.replayLimit ?? 200, order: "desc" }),
      input.sdk.permission.list({ sessionID: input.sessionID }),
      input.sdk.question.list({ sessionID: input.sessionID }),
      input.sdk.session.active(),
    ])
    const projected = structuredClone(messages.data).toReversed() as SessionMessageInfo[]
    for (const message of projected) renderMessage(message, next.render, next.reuseVisibleWait)
    state.permissions = permissions.map(permission)
    state.questions = questions.map(question)
    syncBlockers()
    await subagents.hydrate({ messages: [...projected], active })
    const running = input.sessionID in active
    write([], { phase: running ? "running" : "idle", status: running ? "assistant responding" : "" })
    if (!running && state.wait && (state.wait.promoted || state.wait.interrupted)) {
      const current = state.wait
      state.wait = undefined
      current.resolve()
    }
  }

  const apply = (event: RunV2Event) => {
    if (catalogEvents.has(event.type)) {
      if (input.directory && event.location?.directory && event.location.directory !== input.directory) return
      input.onCatalogRefresh?.()
      return
    }
    const source = sessionID(event)
    if (source !== input.sessionID) {
      if (source) subagents.foreign(source, event)
      return
    }
    input.trace?.write("recv.event", event)
    subagents.main(event)
    if (event.type === "session.prompt.promoted") {
      if (state.wait?.messageID === event.data.inputID) state.wait.promoted = true
      state.messageIDs.add(event.data.inputID)
      write([], { phase: "running", status: "waiting for assistant" })
      return
    }
    if (event.type === "session.step.started") {
      write([], { phase: "running", status: "assistant responding" })
      return
    }
    if (event.type === "session.skill.activated") {
      const messageID = messageIDFromEvent(event.id)
      if (state.wait?.messageID === messageID) state.wait.promoted = true
      if (state.skillMessages.has(messageID)) return
      state.skillMessages.add(messageID)
      write([skillCommit(messageID, event.data.name)])
      return
    }
    if (event.type === "session.shell.started") {
      state.shellCommands.set(event.data.shell.id, event.data.shell.command)
      const wait = state.shellWait
      if (wait?.eventID === event.id) wait.callID = event.data.shell.id
      if (state.shellStarted.has(event.data.shell.id)) return
      state.shellStarted.add(event.data.shell.id)
      write(
        [
          shellCommit(event.data.shell.id, event.data.shell.command, {
            text: "running shell",
            phase: "start",
            toolState: "running",
          }),
        ],
        {
          phase: "running",
          status: "running shell",
        },
      )
      return
    }
    if (event.type === "session.shell.ended") {
      const command = state.shellCommands.get(event.data.shell.id) ?? event.data.shell.command
      const commits: StreamCommit[] = []
      if (!state.shellStarted.has(event.data.shell.id)) {
        state.shellStarted.add(event.data.shell.id)
        if (command)
          commits.push(
            shellCommit(event.data.shell.id, command, { text: "running shell", phase: "start", toolState: "running" }),
          )
      }
      if (!state.shellEnded.has(event.data.shell.id)) {
        state.shellEnded.add(event.data.shell.id)
        commits.push(...shellTerminal(event.data.shell.id, command, event.data.shell, event.data.output))
      }
      const wait = state.shellWait
      const owned = wait?.callID === event.data.shell.id
      write(commits, owned || state.wait || state.shellWait ? undefined : { phase: "idle", status: "" })
      if (owned) wait.resolve()
      return
    }
    if (event.type === "session.text.started") {
      return
    }
    if (event.type === "session.text.delta") {
      const id = `text:${event.data.ordinal}`
      const key = streamPartKey(event.data.assistantMessageID, id)
      const projected = state.projectedText.get(key)
      const covered = projected?.indexOf(event.data.delta) ?? -1
      if (projected && covered >= 0) {
        state.projectedText.set(key, projected.slice(covered + event.data.delta.length))
        return
      }
      const previous = state.text.get(key) ?? ""
      state.text.set(key, previous + event.data.delta)
      write([
        {
          kind: "assistant",
          source: "assistant",
          text: event.data.delta,
          phase: "progress",
          messageID: event.data.assistantMessageID,
          partID: id,
        },
      ])
      return
    }
    if (event.type === "session.text.ended") {
      const id = `text:${event.data.ordinal}`
      const key = streamPartKey(event.data.assistantMessageID, id)
      const previous = state.text.get(key) ?? ""
      if (event.data.text.length > previous.length)
        write([
          {
            kind: "assistant",
            source: "assistant",
            text: event.data.text.slice(previous.length),
            phase: "progress",
            messageID: event.data.assistantMessageID,
            partID: id,
          },
        ])
      state.text.set(key, event.data.text)
      state.projectedText.delete(key)
      return
    }
    if (event.type === "session.reasoning.started") {
      return
    }
    if (event.type === "session.reasoning.delta") {
      const id = `reasoning:${event.data.ordinal}`
      const key = streamPartKey(event.data.assistantMessageID, id)
      const projected = state.projectedReasoning.get(key)
      const covered = projected?.indexOf(event.data.delta) ?? -1
      if (projected && covered >= 0) {
        state.projectedReasoning.set(key, projected.slice(covered + event.data.delta.length))
        return
      }
      const previous = state.reasoning.get(key) ?? ""
      state.reasoning.set(key, previous + event.data.delta)
      if (input.thinking)
        write([
          {
            kind: "reasoning",
            source: "reasoning",
            text: previous ? event.data.delta : `Thinking: ${event.data.delta}`,
            phase: "progress",
            messageID: event.data.assistantMessageID,
            partID: id,
          },
        ])
      return
    }
    if (event.type === "session.reasoning.ended") {
      const id = `reasoning:${event.data.ordinal}`
      const key = streamPartKey(event.data.assistantMessageID, id)
      const previous = state.reasoning.get(key) ?? ""
      if (input.thinking && event.data.text.length > previous.length)
        write([
          {
            kind: "reasoning",
            source: "reasoning",
            text: previous ? event.data.text.slice(previous.length) : `Thinking: ${event.data.text}`,
            phase: "progress",
            messageID: event.data.assistantMessageID,
            partID: id,
          },
        ])
      state.reasoning.set(key, event.data.text)
      state.projectedReasoning.delete(key)
      return
    }
    if (event.type === "session.tool.input.started") {
      state.tools.set(event.data.callID, {
        messageID: event.data.assistantMessageID,
        name: event.data.name,
        input: {},
        started: event.created,
        running: false,
      })
      return
    }
    if (event.type === "session.tool.called") {
      if (state.finishedTools.has(event.data.callID)) return
      const current = state.tools.get(event.data.callID)
      const item = structuredClone({
        type: "tool",
        id: event.data.callID,
        name: current?.name ?? "tool",
        executed: event.data.executed,
        providerState: event.data.state,
        state: { status: "running", input: event.data.input, structured: {}, content: [] },
        time: { created: current?.started ?? event.created, ran: event.created },
      }) as SessionMessageAssistantTool
      renderTool(event.data.assistantMessageID, item)
      return
    }
    if (event.type === "session.tool.progress") return
    if (event.type === "session.tool.success" || event.type === "session.tool.failed") {
      const current = state.tools.get(event.data.callID)
      const failed = event.type === "session.tool.failed"
      const item = structuredClone({
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
        time: { created: current?.started ?? event.created, ran: current?.started, completed: event.created },
      }) as SessionMessageAssistantTool
      renderTool(event.data.assistantMessageID, item)
      return
    }
    if (event.type === "permission.v2.asked") {
      if (!state.permissions.some((item) => item.id === event.data.id)) state.permissions.push(permission(event.data))
      syncBlockers()
      return
    }
    if (event.type === "permission.v2.replied") {
      state.permissions = state.permissions.filter((item) => item.id !== event.data.requestID)
      syncBlockers()
      return
    }
    if (event.type === "question.v2.asked") {
      if (!state.questions.some((item) => item.id === event.data.id)) state.questions.push(question(event.data))
      syncBlockers()
      return
    }
    if (event.type === "question.v2.replied" || event.type === "question.v2.rejected") {
      state.questions = state.questions.filter((item) => item.id !== event.data.requestID)
      syncBlockers()
      return
    }
    if (event.type === "session.step.ended") {
      const total =
        event.data.tokens.input +
        event.data.tokens.output +
        event.data.tokens.reasoning +
        event.data.tokens.cache.read +
        event.data.tokens.cache.write
      const usage = total > 0 ? total.toLocaleString() : ""
      write([], {
        usage: event.data.cost ? `${usage} · ${money.format(event.data.cost)}` : usage,
      })
      return
    }
    if (event.type === "session.step.failed") {
      state.errors.add(event.data.assistantMessageID)
      if (state.wait) state.wait.failureRendered = true
      write([{ kind: "error", source: "system", text: errorMessage(event.data.error), phase: "start" }])
      return
    }
    if (event.type === "session.execution.started") {
      write([], { phase: "running" })
      return
    }
    if (
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted"
    ) {
      write([], { phase: "idle", status: "" })
      const current = state.wait
      if (!current || (!current.promoted && !current.interrupted)) return
      state.wait = undefined
      if (current.interrupted && event.type === "session.execution.interrupted" && event.data.reason === "user") {
        current.resolve()
        return
      }
      if (event.type === "session.execution.failed") {
        if (current.failureRendered) {
          current.resolve()
          return
        }
        current.reject(new Error(errorMessage(event.data.error)))
        return
      }
      if (event.type === "session.execution.interrupted") {
        current.reject(new Error(`Session interrupted: ${event.data.reason}`))
        return
      }
      current.resolve()
    }
  }

  const receive = (event: RunV2Event) => {
    if (state.buffered) {
      state.buffered.push(event)
      return
    }
    apply(event)
  }

  const connect = async () => {
    while (!controller.signal.aborted && !input.footer.isClosed) {
      const error = await (async () => {
        const connection = new AbortController()
        const abortConnection = () => connection.abort()
        controller.signal.addEventListener("abort", abortConnection, { once: true })
        const stream = input.sdk.event.subscribe({ signal: connection.signal })[Symbol.asyncIterator]()
        try {
          const first = await stream.next()
          if (first.done || first.value.type !== "server.connected") throw new Error("Event stream disconnected")
          const buffered: RunV2Event[] = []
          let booting = true
          const consume = (async () => {
            while (!connection.signal.aborted) {
              const next = await stream.next()
              if (next.done) throw new Error("Event stream disconnected")
              if (booting) buffered.push(next.value)
              else receive(next.value)
            }
          })()
          void consume.catch(() => {})
          await hydrate({ render: state.initial ? input.replay === true : true, reuseVisibleWait: !state.initial })
          input.onCatalogRefresh?.()
          state.initial = false
          booting = false
          for (const event of buffered.splice(0)) apply(event)
          state.connected = true
          readyResolve()
          await consume
        } finally {
          controller.signal.removeEventListener("abort", abortConnection)
          connection.abort()
          void stream.return?.(undefined).catch(() => {})
        }
      })().catch((error) => error)
      state.connected = false
      if (controller.signal.aborted || input.footer.isClosed) return
      input.trace?.write("recv.reconnect", { error: formatUnknownError(error) })
      write([], { phase: "running", status: "reconnecting" })
      await wait(250, controller.signal)
    }
  }
  const connection = connect()
  try {
    await ready
  } catch (error) {
    offFooterClose()
    throw error
  } finally {
    controller.signal.removeEventListener("abort", abortReady)
  }

  const runShellTurn = async (next: SessionTurnInput) => {
    if (state.wait || state.shellWait) throw new Error("prompt already running")
    if (!state.connected) throw new Error("Event stream is reconnecting")
    const abort = new AbortController()
    const onAbort = () => abort.abort()
    next.signal?.addEventListener("abort", onAbort, { once: true })
    let rendered!: () => void
    const output = new Promise<void>((resolve) => {
      rendered = resolve
    })
    const eventID = Event.ID.create()
    const active: ShellWait = {
      eventID,
      messageID: messageIDFromEvent(eventID),
      resolve: rendered,
      abort: () => abort.abort(),
    }
    state.shellWait = active
    input.trace?.write("send.shell", { sessionID: input.sessionID, id: eventID, command: next.prompt.text })
    write([], { phase: "running", status: "running shell" })
    try {
      await input.sdk.session.shell(
        { sessionID: input.sessionID, id: eventID, command: next.prompt.text },
        { signal: abort.signal },
      )
      await Promise.race([output, wait(SHELL_OUTPUT_GRACE_MS, abort.signal)])
    } catch (error) {
      if (abort.signal.aborted) return
      throw error
    } finally {
      next.signal?.removeEventListener("abort", onAbort)
      if (state.shellWait === active) state.shellWait = undefined
    }
  }

  // Shared settlement scaffolding for prompt-shaped turns: registers the wait,
  // wires interruption, sends, then blocks until the live settled event (or a
  // hydration pass over an idle session) resolves it.
  const runTurnWait = async (
    next: SessionTurnInput,
    messageID: string,
    turn: { promoted?: boolean; send: () => Promise<unknown> },
  ) => {
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const done = new Promise<void>((ok, fail) => {
      resolve = ok
      reject = fail
    })
    const active: Wait = {
      messageID,
      promoted: turn.promoted === true,
      interrupted: false,
      failureRendered: false,
      resolve,
      reject,
      onVisibleOutput: next.onVisibleOutput,
    }
    state.wait = active
    const interrupt = () => {
      active.interrupted = true
      void input.sdk.session.interrupt({ sessionID: input.sessionID }).catch(() => {})
    }
    next.signal?.addEventListener("abort", interrupt, { once: true })
    try {
      await turn.send()
      await done
    } catch (error) {
      if (state.wait === active) state.wait = undefined
      if (next.signal?.aborted) return
      throw error
    } finally {
      next.signal?.removeEventListener("abort", interrupt)
    }
  }

  return {
    async runPromptTurn(next) {
      if (next.prompt.mode === "shell") {
        await runShellTurn(next)
        return
      }
      if (state.wait || state.shellWait) throw new Error("prompt already running")
      if (!state.connected) throw new Error("Event stream is reconnecting")
      const messageID = next.prompt.messageID
      if (!messageID) throw new Error("Prompt message ID is required")

      const command = next.prompt.command
      if (command?.source === "skill") {
        input.trace?.write("send.skill", { sessionID: input.sessionID, messageID, skill: command.name })
        await runTurnWait(next, messageID, {
          send: () =>
            input.sdk.session.skill(
              { sessionID: input.sessionID, id: messageID, skill: command.name },
              { signal: next.signal },
            ),
        })
        return
      }
      if (command) {
        const selected = await resolveSelectedModel(input, next)
        if (next.variant && !selected) throw new Error("Cannot select a variant before selecting a model")
        // Agent and model ride the command payload; the server switches only
        // when the command itself does not pin them.
        const files = [
          ...(next.includeFiles ? next.files : []).map((file) => ({ uri: file.url, name: file.filename })),
          ...promptFiles(next),
        ]
        const agents = promptAgents(next)
        input.trace?.write("send.command", { sessionID: input.sessionID, messageID, command: command.name })
        await runTurnWait(next, messageID, {
          send: () =>
            input.sdk.session.command(
              {
                sessionID: input.sessionID,
                id: messageID,
                command: command.name,
                arguments: command.arguments,
                agent: next.agent,
                model: selected,
                files: files.length ? files : undefined,
                agents: agents.length ? agents : undefined,
                delivery: "steer",
              },
              { signal: next.signal },
            ),
        })
        return
      }

      if (next.agent) {
        await input.sdk.session.switchAgent({ sessionID: input.sessionID, agent: next.agent }, { signal: next.signal })
      }
      const selected = await resolveSelectedModel(input, next)
      if (next.variant && !selected) throw new Error("Cannot select a variant before selecting a model")
      if (selected)
        await input.sdk.session.switchModel({ sessionID: input.sessionID, model: selected }, { signal: next.signal })

      const prepared = await Promise.all((next.includeFiles ? next.files : []).map(prepareFile))
      const attachments = [
        ...prepared.flatMap((file) => (file.attachment ? [file.attachment] : [])),
        ...promptFiles(next),
      ]
      const agents = promptAgents(next)
      input.trace?.write("send.prompt", { sessionID: input.sessionID, messageID })
      await runTurnWait(next, messageID, {
        send: () =>
          input.sdk.session.prompt(
            {
              sessionID: input.sessionID,
              id: messageID,
              prompt: {
                text: [next.prompt.text, ...prepared.flatMap((file) => (file.text ? [file.text] : []))].join("\n\n"),
                files: attachments.length ? attachments : undefined,
                agents: agents.length ? agents : undefined,
              },
              delivery: "steer",
            },
            { signal: next.signal },
          ),
      })
    },
    async interruptActiveTurn() {
      // A running shell holds no drain, so session.interrupt cannot reach it;
      // abort the blocking request instead. The server-side command keeps its
      // own lifecycle and simply loses its waiter.
      const shell = state.shellWait
      if (shell) {
        shell.abort()
        return
      }
      if (state.wait) state.wait.interrupted = true
      await input.sdk.session.interrupt({ sessionID: input.sessionID }).catch(() => {})
    },
    selectSubagent(sessionID) {
      subagents.select(sessionID)
    },
    async replayOnResize(next) {
      if (!input.replay || state.closed || input.footer.isClosed) return false
      const buffered: RunV2Event[] = []
      state.buffered = buffered
      try {
        await input.footer.idle()
        await next.reset()
        state.messageIDs.clear()
        state.text.clear()
        state.projectedText.clear()
        state.reasoning.clear()
        state.projectedReasoning.clear()
        state.tools.clear()
        state.finishedTools.clear()
        state.skillMessages.clear()
        state.shellCommands.clear()
        state.shellStarted.clear()
        state.shellEnded.clear()
        state.errors.clear()
        await hydrate({ render: true, reuseVisibleWait: false })
      } finally {
        state.buffered = undefined
      }
      for (const event of buffered) apply(event)
      for (const row of next.localRows()) {
        if (row.commit.messageID && state.messageIDs.has(row.commit.messageID)) continue
        input.footer.append(row.commit)
      }
      return true
    },
    async close() {
      state.closed = true
      offFooterClose()
      controller.abort()
      void connection.catch(() => {})
    },
  }
}

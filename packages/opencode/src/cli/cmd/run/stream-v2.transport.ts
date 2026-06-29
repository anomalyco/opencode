import type {
  OpencodeClient,
  PermissionRequest,
  PermissionV2Request,
  QuestionRequest,
  QuestionV2Request,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  ToolPart,
  V2Event1,
} from "@opencode-ai/sdk/v2"
import { blockerStatus, pickBlockerView } from "./session-data"
import { writeSessionOutput } from "./stream"
import type {
  FooterApi,
  FooterView,
  LocalReplayAnchor,
  LocalReplayRow,
  RunFilePart,
  RunInput,
  RunPrompt,
  RunProvider,
  StreamCommit,
} from "./types"

type Trace = {
  write(type: string, data?: unknown): void
}

type StreamInput = {
  sdk: OpencodeClient
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
  selectSubagent(sessionID: string | undefined): void
  replayOnResize(input: SessionResizeReplayInput): Promise<boolean>
  close(): Promise<void>
}

type Wait = {
  messageID: string
  promoted: boolean
  failureRendered: boolean
  resolve: () => void
  reject: (error: unknown) => void
  onVisibleOutput?: (anchor: LocalReplayAnchor) => void
}

type ToolState = {
  messageID: string
  name: string
  input: Record<string, unknown>
  started: number
  running: boolean
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
  wait?: Wait
  connected: boolean
  closed: boolean
  initial: boolean
  buffered?: V2Event1[]
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
    patterns: request.resources,
    metadata: request.metadata ?? {},
    always: request.save ?? [],
    tool: request.source?.type === "tool" ? request.source : undefined,
  }
}

function question(request: QuestionV2Request): QuestionRequest {
  return {
    id: request.id,
    sessionID: request.sessionID,
    questions: request.questions,
    tool: request.tool,
  }
}

function outputText(content: Array<{ type: string; text?: string }>) {
  return content.flatMap((item) => (item.type === "text" && item.text ? [item.text] : [])).join("\n")
}

function legacyTool(input: {
  sessionID: string
  messageID: string
  callID: string
  name: string
  state: SessionMessageAssistantTool["state"]
  time: SessionMessageAssistantTool["time"]
  provider?: SessionMessageAssistantTool["provider"]
}): ToolPart {
  const base = {
    id: `prt_${input.callID}`,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "tool" as const,
    callID: input.callID,
    tool: input.name,
  }
  if (input.state.status === "pending") {
    return {
      ...base,
      state: { status: "pending", input: {}, raw: input.state.input },
    }
  }
  if (input.state.status === "running") {
    return {
      ...base,
      state: {
        status: "running",
        input: input.state.input,
        title: input.name,
        metadata: { structured: input.state.structured, content: input.state.content, providerCall: input.provider },
        time: { start: input.time.ran ?? input.time.created },
      },
    }
  }
  if (input.state.status === "completed") {
    return {
      ...base,
      state: {
        status: "completed",
        input: input.state.input,
        output: outputText(input.state.content),
        title: input.name,
        metadata: {
          structured: input.state.structured,
          content: input.state.content,
          outputPaths: input.state.outputPaths,
          result: input.state.result,
          providerCall: input.provider,
        },
        time: { start: input.time.ran ?? input.time.created, end: input.time.completed ?? input.time.created },
      },
    }
  }
  return {
    ...base,
    state: {
      status: "error",
      input: input.state.input,
      error: input.state.error.message,
      metadata: {
        structured: input.state.structured,
        content: input.state.content,
        result: input.state.result,
        providerCall: input.provider,
      },
      time: { start: input.time.ran ?? input.time.created, end: input.time.completed ?? input.time.created },
    },
  }
}

function toolCommit(part: ToolPart, phase: "start" | "progress" | "final"): StreamCommit {
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

function sessionID(event: V2Event1) {
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
  if (file.mime !== "text/plain") return { attachment: { uri: file.url, mime: file.mime, name: file.filename } }
  const content = file.url.startsWith("data:")
    ? Buffer.from(file.url.slice(file.url.indexOf(",") + 1), "base64").toString("utf8")
    : await Bun.file(new URL(file.url)).text()
  return { text: `<file name="${file.filename}">\n${content}\n</file>` }
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
      callID: item.id,
      name: item.name,
      state: item.state,
      time: item.time,
      provider: item.provider,
    })
    if (item.state.status === "pending") return
    if (item.state.status === "running") {
      if (state.tools.get(item.id)?.running) return
      state.tools.set(item.id, {
        messageID,
        name: item.name,
        input: item.state.input,
        started: item.time.ran ?? item.time.created,
        running: true,
      })
      write([toolCommit(part, "start")], { phase: "running", status: `running ${item.name}` })
      return
    }
    if (state.finishedTools.has(item.id)) return
    if (!state.tools.get(item.id)?.running) write([toolCommit(part, "start")])
    state.finishedTools.add(item.id)
    state.tools.delete(item.id)
    write([toolCommit(part, item.state.status === "completed" && part.state.status === "completed" && part.state.output ? "progress" : "final")])
  }

  const renderMessage = (message: SessionMessage, render: boolean) => {
    if (message.type === "user") {
      if (state.wait?.messageID === message.id) state.wait.promoted = true
      if (!render || state.messageIDs.has(message.id)) return
      state.messageIDs.add(message.id)
      write([{ kind: "user", source: "system", text: message.text, phase: "start", messageID: message.id }])
      return
    }
    if (message.type !== "assistant") return
    state.messageIDs.add(message.id)
    for (const item of message.content) {
      if (item.type === "text") {
        const sent = state.text.get(item.id)?.length ?? 0
        state.text.set(item.id, item.text)
        if (render) state.projectedText.set(item.id, item.text)
        if (render && item.text.length > sent)
          write([
            {
              kind: "assistant",
              source: "assistant",
              text: item.text.slice(sent),
              phase: "progress",
              messageID: message.id,
              partID: item.id,
            },
          ])
        continue
      }
      if (item.type === "reasoning") {
        const sent = state.reasoning.get(item.id)?.length ?? 0
        state.reasoning.set(item.id, item.text)
        if (render) state.projectedReasoning.set(item.id, item.text)
        if (render && input.thinking && item.text.length > sent)
          write([
            {
              kind: "reasoning",
              source: "reasoning",
              text: sent === 0 ? `Thinking: ${item.text}` : item.text.slice(sent),
              phase: "progress",
              messageID: message.id,
              partID: item.id,
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

  const hydrate = async (render: boolean) => {
    const [messages, permissions, questions, active] = await Promise.all([
      input.sdk.v2.session.messages(
        { sessionID: input.sessionID, limit: input.replayLimit ?? 200, order: "desc" },
        { throwOnError: true },
      ),
      input.sdk.v2.session.permission.list({ sessionID: input.sessionID }, { throwOnError: true }),
      input.sdk.v2.session.question.list({ sessionID: input.sessionID }, { throwOnError: true }),
      input.sdk.v2.session.active({ throwOnError: true }),
    ])
    for (const message of messages.data.data.toReversed()) renderMessage(message, render)
    state.permissions = permissions.data.data.map(permission)
    state.questions = questions.data.data.map(question)
    syncBlockers()
    const running = input.sessionID in active.data.data
    write([], { phase: running ? "running" : "idle", status: running ? "assistant responding" : "" })
    if (!running && state.wait?.promoted) {
      const current = state.wait
      state.wait = undefined
      current.resolve()
    }
  }

  const apply = (event: V2Event1) => {
    if (sessionID(event) !== input.sessionID) return
    input.trace?.write("recv.event", event)
    if (event.type === "session.next.prompted") {
      if (state.wait?.messageID === event.data.messageID) state.wait.promoted = true
      state.messageIDs.add(event.data.messageID)
      write([], { phase: "running", status: "waiting for assistant" })
      return
    }
    if (event.type === "session.next.step.started") {
      write([], { phase: "running", status: "assistant responding" })
      return
    }
    if (event.type === "session.next.text.delta") {
      const projected = state.projectedText.get(event.data.textID)
      const covered = projected?.indexOf(event.data.delta) ?? -1
      if (projected && covered >= 0) {
        state.projectedText.set(event.data.textID, projected.slice(covered + event.data.delta.length))
        return
      }
      const previous = state.text.get(event.data.textID) ?? ""
      state.text.set(event.data.textID, previous + event.data.delta)
      write([
        {
          kind: "assistant",
          source: "assistant",
          text: event.data.delta,
          phase: "progress",
          messageID: event.data.assistantMessageID,
          partID: event.data.textID,
        },
      ])
      return
    }
    if (event.type === "session.next.text.ended") {
      const previous = state.text.get(event.data.textID) ?? ""
      if (event.data.text.length > previous.length)
        write([
          {
            kind: "assistant",
            source: "assistant",
            text: event.data.text.slice(previous.length),
            phase: "progress",
            messageID: event.data.assistantMessageID,
            partID: event.data.textID,
          },
        ])
      state.text.set(event.data.textID, event.data.text)
      state.projectedText.delete(event.data.textID)
      return
    }
    if (event.type === "session.next.reasoning.delta") {
      const projected = state.projectedReasoning.get(event.data.reasoningID)
      const covered = projected?.indexOf(event.data.delta) ?? -1
      if (projected && covered >= 0) {
        state.projectedReasoning.set(event.data.reasoningID, projected.slice(covered + event.data.delta.length))
        return
      }
      const previous = state.reasoning.get(event.data.reasoningID) ?? ""
      state.reasoning.set(event.data.reasoningID, previous + event.data.delta)
      if (input.thinking)
        write([
          {
            kind: "reasoning",
            source: "reasoning",
            text: previous ? event.data.delta : `Thinking: ${event.data.delta}`,
            phase: "progress",
            messageID: event.data.assistantMessageID,
            partID: event.data.reasoningID,
          },
        ])
      return
    }
    if (event.type === "session.next.reasoning.ended") {
      const previous = state.reasoning.get(event.data.reasoningID) ?? ""
      if (input.thinking && event.data.text.length > previous.length)
        write([
          {
            kind: "reasoning",
            source: "reasoning",
            text: previous ? event.data.text.slice(previous.length) : `Thinking: ${event.data.text}`,
            phase: "progress",
            messageID: event.data.assistantMessageID,
            partID: event.data.reasoningID,
          },
        ])
      state.reasoning.set(event.data.reasoningID, event.data.text)
      state.projectedReasoning.delete(event.data.reasoningID)
      return
    }
    if (event.type === "session.next.tool.input.started") {
      state.tools.set(event.data.callID, {
        messageID: event.data.assistantMessageID,
        name: event.data.name,
        input: {},
        started: event.data.timestamp,
        running: false,
      })
      return
    }
    if (event.type === "session.next.tool.called") {
      if (state.finishedTools.has(event.data.callID)) return
      const current = state.tools.get(event.data.callID)
      const item: SessionMessageAssistantTool = {
        type: "tool",
        id: event.data.callID,
        name: event.data.tool,
        provider: event.data.provider,
        state: { status: "running", input: event.data.input, structured: {}, content: [] },
        time: { created: current?.started ?? event.data.timestamp, ran: event.data.timestamp },
      }
      renderTool(event.data.assistantMessageID, item)
      return
    }
    if (event.type === "session.next.tool.progress") return
    if (event.type === "session.next.tool.success" || event.type === "session.next.tool.failed") {
      const current = state.tools.get(event.data.callID)
      const failed = event.type === "session.next.tool.failed"
      const item: SessionMessageAssistantTool = {
        type: "tool",
        id: event.data.callID,
        name: current?.name ?? "tool",
        provider: event.data.provider,
        state: failed
          ? { status: "error", input: current?.input ?? {}, structured: {}, content: [], error: event.data.error, result: event.data.result }
          : {
              status: "completed",
              input: current?.input ?? {},
              structured: event.data.structured,
              content: event.data.content,
              outputPaths: event.data.outputPaths,
              result: event.data.result,
            },
        time: { created: current?.started ?? event.data.timestamp, ran: current?.started, completed: event.data.timestamp },
      }
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
    if (event.type === "session.next.step.ended") {
      const total =
        event.data.tokens.input +
        event.data.tokens.output +
        event.data.tokens.reasoning +
        event.data.tokens.cache.read +
        event.data.tokens.cache.write
      const usage = total > 0 ? total.toLocaleString() : ""
      write([], { phase: event.data.finish === "tool-calls" ? "running" : "idle", usage: event.data.cost ? `${usage} · ${money.format(event.data.cost)}` : usage })
      return
    }
    if (event.type === "session.next.step.failed") {
      state.errors.add(event.data.assistantMessageID)
      if (state.wait) state.wait.failureRendered = true
      write([{ kind: "error", source: "system", text: errorMessage(event.data.error), phase: "start" }])
      return
    }
    if (event.type === "session.next.execution.settled") {
      write([], { phase: "idle", status: "" })
      const current = state.wait
      if (!current?.promoted) return
      state.wait = undefined
      if (event.data.outcome === "failure") {
        if (current.failureRendered) {
          current.resolve()
          return
        }
        current.reject(new Error(event.data.error ? errorMessage(event.data.error) : "Session execution failed"))
        return
      }
      current.resolve()
    }
  }

  const receive = (event: V2Event1) => {
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
        const response = await input.sdk.v2.event.subscribe({
          signal: connection.signal,
          sseMaxRetryAttempts: 0,
          throwOnError: true,
        })
          const stream = response.stream[Symbol.asyncIterator]() as AsyncGenerator<V2Event1>
        try {
          const first = await stream.next()
          if (first.done || first.value.type !== "server.connected") throw new Error("Event stream disconnected")
          const buffered: V2Event1[] = []
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
          await hydrate(state.initial ? input.replay === true : true)
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

  return {
    async runPromptTurn(next) {
      if (next.prompt.mode === "shell") throw new Error("Shell is not yet available for current Session transcripts")
      if (next.prompt.command) throw new Error("Commands are not yet available for current Session transcripts")
      if (state.wait) throw new Error("prompt already running")
      if (!state.connected) throw new Error("Event stream is reconnecting")

      if (next.agent) {
        await input.sdk.v2.session.switchAgent(
          { sessionID: input.sessionID, agent: next.agent },
          { throwOnError: true, signal: next.signal },
        )
      }
      const selected = next.model
        ? { providerID: next.model.providerID, id: next.model.modelID, variant: next.variant }
        : next.variant
          ? await input.sdk.v2.session
              .get({ sessionID: input.sessionID }, { throwOnError: true, signal: next.signal })
              .then((response) => response.data.data.model)
              .then((model) => (model ? { ...model, variant: next.variant } : undefined))
          : undefined
      if (next.variant && !selected) throw new Error("Cannot select a variant before selecting a model")
      if (selected)
        await input.sdk.v2.session.switchModel(
          { sessionID: input.sessionID, model: selected },
          { throwOnError: true, signal: next.signal },
        )

      const prepared = await Promise.all((next.includeFiles ? next.files : []).map(prepareFile))
      const attachments = [
        ...prepared.flatMap((file) => (file.attachment ? [file.attachment] : [])),
        ...next.prompt.parts.flatMap((part) =>
          part.type === "file"
            ? [
                {
                  uri: part.url,
                  mime: part.mime,
                  name: part.filename,
                  source: part.source?.text
                    ? {
                        start: part.source.text.start,
                        end: part.source.text.end,
                        text: part.source.text.value,
                      }
                    : undefined,
                },
              ]
            : [],
        ),
      ]
      const agents = next.prompt.parts.flatMap((part) =>
        part.type === "agent"
          ? [
              {
                name: part.name,
                source: part.source
                  ? { start: part.source.start, end: part.source.end, text: part.source.value }
                  : undefined,
              },
            ]
          : [],
      )
      const messageID = next.prompt.messageID
      if (!messageID) throw new Error("Prompt message ID is required")
      let resolve!: () => void
      let reject!: (error: unknown) => void
      const done = new Promise<void>((done, fail) => {
        resolve = done
        reject = fail
      })
      const active: Wait = {
        messageID,
        promoted: false,
        failureRendered: false,
        resolve,
        reject,
        onVisibleOutput: next.onVisibleOutput,
      }
      state.wait = active
      const interrupt = () => {
        void input.sdk.v2.session.interrupt({ sessionID: input.sessionID }).catch(() => {})
      }
      next.signal?.addEventListener("abort", interrupt, { once: true })
      try {
        input.trace?.write("send.prompt", { sessionID: input.sessionID, messageID })
        await input.sdk.v2.session.prompt(
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
          { throwOnError: true, signal: next.signal },
        )
        await done
      } catch (error) {
        if (state.wait === active) state.wait = undefined
        if (next.signal?.aborted) return
        throw error
      } finally {
        next.signal?.removeEventListener("abort", interrupt)
      }
    },
    selectSubagent() {},
    async replayOnResize(next) {
      if (!input.replay || state.closed || input.footer.isClosed) return false
      const buffered: V2Event1[] = []
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
        state.errors.clear()
        await hydrate(true)
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

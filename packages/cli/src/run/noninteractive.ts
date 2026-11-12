import {
  ClientError,
  type EventSubscribeOutput,
  type ExperimentalJobListOutput,
  type FormInfo,
  type JsonValue,
  type LocationRef,
  type ModelRef,
  type OpenCodeClient,
  type PermissionRequest,
  type SessionMessageAssistantTool,
  type SessionMessageIdle,
  type SessionMessageInfo,
} from "@opencode/client/promise"
import { SessionMessage } from "@opencode/schema/session-message"
import { EOL } from "node:os"
import { toolOutputText, type MiniToolPart } from "@opencode/tui/mini/tool"
import { UI } from "./ui"

type Input = {
  client: OpenCodeClient
  sessionID: string
  location: LocationRef
  message: string
  files: { uri: string; name: string }[]
  agent?: string
  model?: ModelRef
  thinking: boolean
  format: "default" | "json"
  auto: boolean
  /** The server is private to this run, so MCP input requests in its location are this run's too. */
  standalone: boolean
  /** Aborted on SIGINT or SIGTERM: the run cancels its Session and background jobs, then returns. */
  signal: AbortSignal
  renderTool: (part: SessionMessageAssistantTool) => Promise<void>
  renderToolError: (part: SessionMessageAssistantTool) => Promise<void>
}

type Event = EventSubscribeOutput
type Job = ExperimentalJobListOutput[number]
type RunError = { type: string; message: string }
type Outcome = Pick<SessionMessageIdle, "id" | "outcome" | "error">

type Tool = {
  id: string
  timestamp: number
  name: string
  input: Record<string, JsonValue>
  raw?: string
  call?: { executed: boolean; state: SessionMessageAssistantTool["native"] }
  metadata: Record<string, JsonValue>
}

const QUESTION_CANCELLED_FEEDBACK =
  "This non-interactive run cannot ask the user questions, so the question was cancelled. Continue without an answer; make reasonable assumptions and state them."

const PERMISSION_REJECTED_FEEDBACK =
  "This non-interactive run cannot ask the user for permission, so the request was rejected. Continue without this action."

/**
 * Runs one prompt to completion:
 *
 *   admitting → running → settling → waiting for this prompt's jobs → done(exit code)
 *   any state + abort (SIGINT/SIGTERM) → cancelling → done
 */
export async function runNonInteractivePrompt(input: Input) {
  const controller = new AbortController()
  const stream = input.client.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
  if ((await stream.next()).done) throw new Error("Event stream disconnected before prompt admission")

  const messageID = SessionMessage.ID.create()
  const render = renderer(input)
  const state = {
    phase: "running" as "running" | "settled" | "cancelling",
    promoted: false,
    admission: undefined as Promise<{ time: { created: number } }> | undefined,
    failure: undefined as RunError | undefined,
    outcomes: [] as Outcome[],
    // Sessions in this run's tree that own jobs; an execution ending in one can change background state.
    jobSessions: new Set([input.sessionID]),
    ended: deferred(),
  }

  // Subagents' asks belong to this run too; other sessions on a shared server must be left alone.
  const owned = new Map([[input.sessionID, Promise.resolve(true)]])
  const ownsSession = (sessionID: string): Promise<boolean> => {
    const known = owned.get(sessionID)
    if (known) return known
    const result = input.client.session.get({ sessionID }).then(
      (session) => (session.parentID ? ownsSession(session.parentID) : false),
      () => false,
    )
    owned.set(sessionID, result)
    return result
  }

  const replyPermission = async (request: PermissionRequest) => {
    if (!input.auto)
      UI.println(
        UI.Style.TEXT_WARNING_BOLD + "!",
        UI.Style.TEXT_NORMAL +
          `permission requested: ${request.action} (${request.resources.join(", ")}); auto-rejecting`,
      )
    await input.client.permission
      .reply({
        sessionID: request.sessionID,
        requestID: request.id,
        decision: input.auto ? "once" : "reject",
        ...(input.auto ? {} : { message: PERMISSION_REJECTED_FEEDBACK }),
      })
      .catch(() => {})
  }

  // A cancelled question lets the model continue; any other input request fails the run.
  // MCP elicitations belong to the "global" sentinel rather than a session; on a shared server they
  // may belong to another client.
  const ownsForm = (form: Pick<FormInfo, "sessionID">, location: LocationRef | undefined) =>
    form.sessionID === "global"
      ? input.standalone && location?.directory === input.location.directory
      : ownsSession(form.sessionID)

  const cancelForm = async (form: Pick<FormInfo, "id" | "sessionID" | "title" | "metadata">) => {
    const question = form.metadata?.kind === "question"
    await input.client.session.form
      .cancel(
        { sessionID: form.sessionID, formID: form.id, ...(question ? { message: QUESTION_CANCELLED_FEEDBACK } : {}) },
        // A global form is found through its location.
        ...(form.sessionID === "global"
          ? [{ headers: { "x-opencode-directory": encodeURIComponent(input.location.directory) } }]
          : []),
      )
      .catch((error) => {
        if (!formAlreadySettled(error)) throw error
      })
    if (!question)
      state.failure ??= {
        type: "unknown",
        message: `Cancelled a request for input this run cannot answer: ${form.title}`,
      }
  }

  const consume = async () => {
    while (true) {
      const next = await stream.next().catch((error) => {
        if (controller.signal.aborted) return { done: true as const, value: undefined }
        throw error
      })
      if (next.done) {
        if (controller.signal.aborted) return
        throw new Error("Event stream disconnected during prompt execution")
      }
      const event = next.value
      if (event.type === "permission.asked") {
        if (await ownsSession(event.data.sessionID)) await replyPermission(event.data)
        continue
      }
      if (event.type === "form.created") {
        if (await ownsForm(event.data.form, event.location)) await cancelForm(event.data.form)
        continue
      }
      if (!("sessionID" in event.data)) continue
      const sessionID = event.data.sessionID
      const terminal = terminalOutcome(event)
      if (state.jobSessions.has(sessionID)) {
        if (event.type === "session.execution.started" && state.phase === "cancelling")
          void input.client.session.interrupt({ sessionID }).catch(() => {})
        if (terminal) {
          state.ended.resolve()
          state.ended = deferred()
        }
      }
      if (sessionID !== input.sessionID) continue
      if (event.type === "session.inbox.delivered" && event.data.inboxID === messageID) state.promoted = true
      // A busy period that ends before this prompt is delivered leaves the prompt queued for good.
      if (terminal && !state.promoted && terminal.error) state.failure ??= terminal.error
      if (terminal && state.promoted) state.outcomes.push(terminal)
      if (state.promoted && state.phase === "running") await render.event(event)
    }
  }

  // The jobs this prompt started (older ones belong to someone else), or `[]` while one of their wakes
  // is queued or running. Work moves job → inbox → active, so reading in that order can't miss it.
  const background = async () => {
    const since = (await state.admission)?.time.created
    if (since === undefined) return undefined
    const jobs = await input.client.experimental.job
      .list({ sessionID: input.sessionID, descendants: true })
      .catch((error) => {
        // Servers older than the job list endpoint answer 404 with no JSON body; they have no jobs to report.
        if (error instanceof ClientError && error.reason === "UnsupportedContentType") return []
        throw error
      })
    const running = jobs.filter((job) => job.time.started >= since)
    running.forEach((job) => {
      state.jobSessions.add(job.sessionID)
      if (job.kind === "subagent") state.jobSessions.add(job.childSessionID)
    })
    if (running.length > 0) return running
    const inboxes = await Promise.all(
      [...state.jobSessions].map((sessionID) => input.client.session.inbox.list({ sessionID })),
    )
    if (inboxes.some((inbox) => inbox.length > 0)) return running
    const active = await input.client.session.active()
    for (const sessionID of Object.keys(active)) {
      if (await ownsSession(sessionID)) return running
    }
    return undefined
  }

  const lifecycle = async () => {
    // admitting
    if (input.agent) await input.client.session.switchAgent({ sessionID: input.sessionID, agent: input.agent })
    if (input.model) await input.client.session.switchModel({ sessionID: input.sessionID, model: input.model })
    if (input.signal.aborted) return
    // A failed stream rejects whatever wait is pending, since no further end could be seen.
    consume().catch((error) => state.ended.reject(error))
    state.admission = input.client.session.prompt({
      sessionID: input.sessionID,
      id: messageID,
      text: input.message,
      files: input.files,
      delivery: "steer",
    })
    await state.admission
    const [permissions, forms, globals] = await Promise.all([
      input.client.permission.list({ sessionID: input.sessionID }).catch(() => []),
      input.client.session.form.list({ sessionID: input.sessionID }).catch(() => []),
      input.standalone
        ? input.client.form.list({ location: { directory: input.location.directory } }).catch(() => undefined)
        : undefined,
    ])
    await Promise.all([
      ...permissions.map(replyPermission),
      ...forms.map(cancelForm),
      ...(globals?.data.filter((form) => ownsForm(form, globals.location) === true) ?? []).map(cancelForm),
    ])

    // running → settling → waiting for this prompt's jobs
    let waited = false
    let shown = 0
    while (true) {
      const ended = state.ended.promise
      await input.client.experimental.session.wait({ sessionID: input.sessionID })
      if (input.signal.aborted) return
      const projected = await projectedMessages(input.client, input.sessionID, messageID)
      if (state.failure || state.outcomes.length > 0 || projected.messages.some((item) => item.type === "idle")) {
        const pending = state.failure ? undefined : await background()
        if (!pending) return { ...projected, background: waited }
        if (pending.length > 0 && pending.length !== shown) render.waiting(pending)
        shown = pending.length || shown
        waited = true
      }
      await ended
    }
  }

  // cancelling: a wake can still start after the interrupt (the notice each cancelled job queues),
  // so the consumer interrupts every execution that starts until the tree is quiet.
  const cancel = async () => {
    state.phase = "cancelling"
    if (!(await state.admission?.catch(() => undefined))) return
    if (!state.promoted)
      await input.client.session.inbox.cancel({ sessionID: input.sessionID, inboxID: messageID }).catch(() => {})
    const running = (await background().catch(() => undefined)) ?? []
    await Promise.all([
      input.client.session.interrupt({ sessionID: input.sessionID }).catch(() => {}),
      ...running.map((job) =>
        (job.kind === "shell"
          ? input.client.shell.remove({ id: job.shellID, location: { directory: input.location.directory } })
          : job.kind === "subagent"
            ? input.client.session.interrupt({ sessionID: job.childSessionID })
            : Promise.resolve()
        ).catch(() => {}),
      ),
    ])
    while (true) {
      const ended = state.ended.promise
      await input.client.experimental.session.wait({ sessionID: input.sessionID })
      const pending = await background()
      // Image jobs can't be cancelled through the API, so waiting on them would only hold the exit.
      if (!pending || (pending.length > 0 && pending.every((job) => job.kind === "image"))) return
      await ended
    }
  }

  try {
    const running = lifecycle()
    const aborted = new Promise<undefined>((resolve) =>
      input.signal.addEventListener("abort", () => resolve(undefined), { once: true }),
    )
    const settled = await Promise.race([running, aborted])
    // Requests failing during or after cancellation (e.g. the private server shutting down) are ignored.
    if (!settled) {
      running.catch(() => {})
      return await cancel().catch(() => {})
    }
    state.phase = "settled"
    await render.reconcile(settled.messages)
    const error = finalError(settled, state)
    if (!error) return
    process.exitCode = 1
    render.error(error)
  } finally {
    controller.abort()
    void stream.return?.(undefined).catch(() => {})
  }
}

/** The run's exit code comes from here alone: the first stored idle marker after this run's prompt. */
function finalError(
  run: { found: boolean; messages: SessionMessageInfo[]; background: boolean },
  state: { failure?: RunError; outcomes: Outcome[] },
) {
  if (state.failure) return state.failure
  if (!run.found) return { type: "unknown", message: "Prompt was not promoted" }
  const idles = run.messages.filter((message) => message.type === "idle")
  const recorded = idles.length > 0 ? idles : state.outcomes
  // The first marker closes this prompt's turn. Later ones count only as replies woken by this
  // prompt's background jobs; otherwise they belong to other prompts, possibly from another client.
  const turns = run.background ? recorded : recorded.slice(0, 1)
  const final = turns.find((turn) => turn.outcome !== "succeeded") ?? turns[0]
  if (!final) return { type: "unknown", message: "Session ended without a recorded outcome" }
  if (final.outcome === "succeeded") return
  const fallback = { type: final.outcome === "failed" ? "unknown" : "aborted", message: `Session ${final.outcome}` }
  return final.error ?? state.outcomes.find((turn) => turn.id === final.id)?.error ?? fallback
}

function terminalOutcome(event: Event): Outcome | undefined {
  const id = SessionMessage.ID.fromEvent(event.id)
  if (event.type === "session.execution.succeeded") return { id, outcome: "succeeded" }
  if (event.type === "session.execution.failed") return { id, outcome: "failed", error: event.data.error }
  if (event.type !== "session.execution.interrupted") return undefined
  return {
    id,
    outcome: "interrupted",
    error: { type: "aborted", message: `Session interrupted: ${event.data.reason}` },
  }
}

async function projectedMessages(client: OpenCodeClient, sessionID: string, messageID: string) {
  const messages: SessionMessageInfo[] = []
  let cursor: string | undefined
  while (true) {
    const page = await client.message.list(
      cursor ? { sessionID, limit: 200, cursor } : { sessionID, limit: 200, order: "desc" },
    )
    for (const message of page.data) {
      if (message.id === messageID) return { found: true, messages: messages.toReversed() }
      messages.push(message)
    }
    cursor = page.cursor.next ?? undefined
    if (!cursor) return { found: false, messages: [] }
  }
}

function renderer(input: Input) {
  const starts = new Map<string, { id: string; timestamp: number }>()
  const tools = new Map<string, Tool>()
  const steps = new Map<string, "started" | "ended">()
  // The session can go idle before the last live events arrive; reconcile prints what they missed.
  const printed = new Map<string, string>()

  const emit = (type: string, timestamp: number, data: Record<string, unknown>) => {
    if (input.format !== "json") return false
    process.stdout.write(JSON.stringify({ type, timestamp, sessionID: input.sessionID, ...data }) + EOL)
    return true
  }

  const block = (line: string) => {
    UI.empty()
    UI.println(line)
    UI.empty()
  }

  const text = (
    part: {
      kind: "text" | "reasoning"
      id: string
      messageID: string
      ordinal: number
      text: string
      metadata?: unknown
    },
    start: number,
    end: number,
  ) => {
    if (part.kind === "reasoning" && !input.thinking) return
    const id = key(part.kind, part.messageID, part.ordinal)
    const previous = printed.get(id) ?? ""
    if (printed.has(id) && (previous === part.text || !part.text.startsWith(previous))) return
    printed.set(id, part.text)
    const value = part.text.slice(previous.length)
    const json = {
      id: part.id,
      sessionID: input.sessionID,
      messageID: part.messageID,
      type: part.kind,
      text: value,
      ...(part.kind === "reasoning" ? { metadata: part.metadata } : {}),
      time: { start, end },
    }
    if (emit(part.kind, end, { part: json })) return
    const trimmed = value.trim()
    if (!trimmed) return
    const line = part.kind === "text" ? trimmed : `Thinking: ${trimmed}`
    if (!process.stdout.isTTY) return void process.stdout.write(line + EOL)
    block(part.kind === "text" ? line : `${UI.Style.TEXT_DIM}\u001b[3m${line}\u001b[0m${UI.Style.TEXT_NORMAL}`)
  }

  const tool = async (
    partID: string,
    messageID: string,
    item: SessionMessageAssistantTool & { state: { status: "completed" | "error" } },
    metadata: Record<string, unknown>,
    timestamp: number,
  ) => {
    const id = key(messageID, item.id)
    if (printed.has(id)) return
    printed.set(id, "")
    const time = { start: item.time.ran ?? item.time.created, end: item.time.completed ?? timestamp }
    const state =
      item.state.status === "completed"
        ? {
            status: "completed" as const,
            input: item.state.input,
            output: toolOutputText(item.name, item.state.content),
            title: item.name,
            metadata,
            time,
          }
        : { status: "error" as const, input: item.state.input, error: item.state.error.message, metadata, time }
    const part = {
      partID,
      sessionID: input.sessionID,
      messageID,
      type: "tool" as const,
      id: item.id,
      tool: item.name,
      state,
    }
    if (emit("tool_use", timestamp, { part: part satisfies MiniToolPart })) return
    if (item.state.status === "completed") return input.renderTool(item)
    if (item.state.content && toolOutputText(item.name, item.state.content).trim())
      await input.renderTool({
        ...item,
        state: {
          status: "completed",
          input: item.state.input,
          metadata: item.state.metadata,
          content: item.state.content,
        },
      })
    await input.renderToolError(item)
    UI.error(item.state.error.message)
  }

  const step = (type: "step-start" | "step-finish", timestamp: number, id: string, messageID: string, rest: object) => {
    steps.set(messageID, type === "step-start" ? "started" : "ended")
    const part = { id, sessionID: input.sessionID, messageID, type, ...rest }
    return emit(type === "step-start" ? "step_start" : "step_finish", timestamp, { part })
  }

  return {
    error: (error: RunError) => {
      if (!emit("error", Date.now(), { error })) UI.error(error.message)
    },

    waiting: (jobs: Job[]) => {
      const list = jobs.map((job) => ({ id: job.id, kind: job.kind, title: job.title }))
      if (emit("background_wait", Date.now(), { jobs: list })) return
      UI.println(
        UI.Style.TEXT_DIM +
          `waiting for ${jobs.length} background job${jobs.length === 1 ? "" : "s"}` +
          UI.Style.TEXT_NORMAL,
      )
    },

    event: async (event: Event) => {
      const time = "created" in event ? event.created : Date.now()
      if (event.type === "session.retry.scheduled") {
        const retry = {
          messageID: event.data.assistantMessageID,
          attempt: event.data.attempt,
          nextRetryAt: event.data.at,
          error: event.data.error,
        }
        if (emit("retry", time, retry)) return
        UI.println(
          UI.Style.TEXT_WARNING_BOLD + "!",
          UI.Style.TEXT_NORMAL + `retrying (attempt ${retry.attempt}): ${retry.error.message}`,
        )
        return
      }
      // Each retried attempt of a step starts it again.
      if (event.type === "session.step.started" && !steps.has(event.data.assistantMessageID)) {
        const rest = { snapshot: event.data.snapshot }
        if (!step("step-start", time, partID(event.id), event.data.assistantMessageID, rest))
          block(`> ${event.data.agent} · ${event.data.model.id}`)
        return
      }
      if (event.type === "session.step.ended") {
        const data = event.data
        const rest = { reason: data.finish, snapshot: data.snapshot, cost: data.cost, tokens: data.tokens }
        step("step-finish", time, partID(event.id), data.assistantMessageID, rest)
        return
      }
      if (event.type === "session.text.started" || event.type === "session.reasoning.started") {
        const kind = event.type === "session.text.started" ? "text" : "reasoning"
        starts.set(key(kind, event.data.assistantMessageID, event.data.ordinal), {
          id: partID(event.id),
          timestamp: time,
        })
        return
      }
      if (event.type === "session.text.ended" || event.type === "session.reasoning.ended") {
        const kind = event.type === "session.text.ended" ? ("text" as const) : ("reasoning" as const)
        const started = starts.get(key(kind, event.data.assistantMessageID, event.data.ordinal))
        const metadata = event.type === "session.reasoning.ended" ? event.data.native : undefined
        const part = {
          kind,
          messageID: event.data.assistantMessageID,
          ordinal: event.data.ordinal,
          text: event.data.text,
        }
        return text({ ...part, id: started?.id ?? partID(event.id), metadata }, started?.timestamp ?? time, time)
      }
      if (event.type === "session.tool.input.started" || event.type === "session.tool.called") {
        const id = key(event.data.assistantMessageID, event.data.id)
        const current = tools.get(id)
        tools.set(id, {
          id: current?.id ?? partID(event.id),
          timestamp: current?.timestamp ?? time,
          name: event.type === "session.tool.input.started" ? event.data.name : (current?.name ?? "tool"),
          input: event.type === "session.tool.called" ? event.data.input : {},
          raw: current?.raw,
          call:
            event.type === "session.tool.called"
              ? { executed: event.data.executed, state: event.data.native }
              : undefined,
          metadata: {},
        })
        return
      }
      if (
        event.type === "session.tool.input.delta" ||
        event.type === "session.tool.input.ended" ||
        event.type === "session.tool.progress"
      ) {
        const current = tools.get(key(event.data.assistantMessageID, event.data.id))
        if (!current) return
        if (event.type === "session.tool.input.delta") current.raw = (current.raw ?? "") + event.data.delta
        if (event.type === "session.tool.input.ended") current.raw = event.data.text
        if (event.type === "session.tool.progress") current.metadata = event.data.metadata
        return
      }
      if (event.type !== "session.tool.success" && event.type !== "session.tool.failed") return
      const current = tools.get(key(event.data.assistantMessageID, event.data.id)) ?? {
        id: partID(event.id),
        timestamp: time,
        name: "tool",
        input: {},
        metadata: {},
      }
      const call = {
        providerCall: current.call,
        providerResult: { executed: event.data.executed, state: event.data.native },
        rawInput: current.raw,
      }
      const item = {
        type: "tool" as const,
        id: event.data.id,
        name: current.name,
        executed: event.data.executed,
        native: event.data.native ? { ...current.call?.state, ...event.data.native } : current.call?.state,
        time: { created: current.timestamp, ran: current.timestamp, completed: time },
      }
      const success = event.type === "session.tool.success"
      const metadata = success ? { metadata: event.data.metadata, content: event.data.content, ...call } : call
      const state = success
        ? {
            status: "completed" as const,
            input: current.input,
            metadata: event.data.metadata,
            content: event.data.content,
          }
        : {
            status: "error" as const,
            input: current.input,
            metadata: event.data.metadata ?? current.metadata,
            content: event.data.content,
            error: event.data.error,
          }
      return tool(current.id, event.data.assistantMessageID, { ...item, state }, metadata, time)
    },

    reconcile: async (messages: SessionMessageInfo[]) => {
      for (const message of messages) {
        if (message.type !== "assistant") continue
        const timestamp = message.time.completed ?? message.time.created
        const seen = steps.get(message.id)
        const id = (part: string) => projectedPartID(message.id, part)
        if (!seen)
          step("step-start", message.time.created, id("step-start"), message.id, { snapshot: message.snapshot?.start })
        const ordinals = { text: 0, reasoning: 0 }
        for (const item of message.content) {
          if (item.type === "tool") {
            if (item.state.status === "streaming" || item.state.status === "running") continue
            const metadata = { metadata: item.state.metadata, content: item.state.content }
            const done = { ...item, state: item.state }
            await tool(id(`tool-${item.id}`), message.id, done, metadata, timestamp)
            continue
          }
          const ordinal = ordinals[item.type]++
          // A part never printed live and still empty has nothing to show.
          if (!item.text && !printed.has(key(item.type, message.id, ordinal))) continue
          const metadata = item.type === "reasoning" ? item.native : undefined
          text(
            {
              kind: item.type,
              id: id(`${item.type}-${ordinal}`),
              messageID: message.id,
              ordinal,
              text: item.text,
              metadata,
            },
            message.time.created,
            timestamp,
          )
        }
        if (seen !== "ended" && message.finish && message.tokens)
          step("step-finish", timestamp, id("step-finish"), message.id, {
            reason: message.finish,
            snapshot: message.snapshot?.end,
            cost: message.cost ?? 0,
            tokens: message.tokens,
          })
      }
    },
  }
}

function deferred() {
  const result = Promise.withResolvers<void>()
  result.promise.catch(() => {})
  return result
}

function formAlreadySettled(error: unknown) {
  return !!error && typeof error === "object" && "_tag" in error && error._tag === "FormAlreadySettledError"
}

function key(...parts: Array<string | number>) {
  return parts.join("\u0000")
}

function partID(eventID: string) {
  return `prt_${eventID.replace(/^evt_/, "")}`
}

function projectedPartID(messageID: string, part: string) {
  return `prt_${messageID.replace(/^msg_/, "")}_${part}`
}

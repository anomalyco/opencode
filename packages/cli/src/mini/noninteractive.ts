import type { EventSubscribeOutput, OpenCodeClient } from "@opencode-ai/client/promise"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { EOL } from "node:os"
import { UI } from "./ui"
import type { MiniToolPart } from "./types"

type Model = {
  providerID: string
  modelID: string
}

type File = {
  url: string
  filename: string
  mime: string
}

type Input = {
  client: OpenCodeClient
  sessionID: string
  message: string
  files: File[]
  agent?: string
  model?: Model
  variant?: string
  thinking: boolean
  format: "default" | "json"
  auto: boolean
  /** True when the client is attached to a shared server rather than an exclusive in-process one. */
  attached: boolean
  renderTool: (part: MiniToolPart) => Promise<void>
  renderToolError: (part: MiniToolPart) => Promise<void>
}

type StartedPart = {
  id: string
  timestamp: number
}

type ToolState = StartedPart & {
  assistantMessageID: string
  tool: string
  input: Record<string, unknown>
  raw?: string
  provider?: unknown
}

type V2Event = EventSubscribeOutput
type FormRequest = Extract<V2Event, { type: "form.created" }>["data"]["form"]

// MCP elicitations are temporarily owned by the "global" sentinel instead of a real
// session. An exclusive local process may treat them as this run's blockers; an
// attached client must not cancel input that may belong to another session.
const GLOBAL_FORM_SESSION_ID = "global"

export async function runNonInteractivePrompt(input: Input) {
  const controller = new AbortController()
  const stream = input.client.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
  const connected = await stream.next()
  if (connected.done) throw new Error("Event stream disconnected before prompt admission")

  const messageID = SessionMessage.ID.create()
  const starts = new Map<string, StartedPart>()
  const tools = new Map<string, ToolState>()
  let submitted = false
  let promoted = false
  let emittedError = false
  let questionRejected = false
  let permissionRejected = false
  let formCancelled = false
  let interrupted = false
  let admission: AbortController | undefined

  const emit = (type: string, timestamp: number, data: Record<string, unknown>) => {
    if (input.format !== "json") return false
    process.stdout.write(JSON.stringify({ type, timestamp, sessionID: input.sessionID, ...data }) + EOL)
    return true
  }

  const writeText = (part: { text: string; [key: string]: unknown }, timestamp: number) => {
    if (emit("text", timestamp, { part })) return
    const text = part.text.trim()
    if (!text) return
    if (!process.stdout.isTTY) {
      process.stdout.write(text + EOL)
      return
    }
    UI.empty()
    UI.println(text)
    UI.empty()
  }

  const replyPermission = async (request: { id: string; action: string; resources: ReadonlyArray<string> }) => {
    if (!input.auto) {
      permissionRejected = true
      UI.println(
        UI.Style.TEXT_WARNING_BOLD + "!",
        UI.Style.TEXT_NORMAL +
          `permission requested: ${request.action} (${request.resources.join(", ")}); auto-rejecting`,
      )
    }
    await input.client.permission
      .reply({
        sessionID: input.sessionID,
        requestID: request.id,
        reply: input.auto ? "once" : "reject",
      })
      .catch(() => {})
    if (!input.auto) {
      await input.client.session.interrupt({ sessionID: input.sessionID }).catch(() => {})
    }
  }

  const rejectQuestion = async (request: { id: string }) => {
    questionRejected = true
    await input.client.question.reject({ sessionID: input.sessionID, requestID: request.id }).catch(() => {})
  }

  const cancelForm = async (request: Pick<FormRequest, "id" | "sessionID">) => {
    formCancelled = true
    await input.client.form.cancel({ sessionID: request.sessionID, formID: request.id }).catch(() => {})
  }

  const consume = async () => {
    while (!controller.signal.aborted) {
      const next = await stream.next().catch((error) => {
        if (!emittedError) throw error
        return { done: true as const, value: undefined }
      })
      if (next.done) {
        if (emittedError) return
        throw new Error("Event stream disconnected during prompt execution")
      }
      const event = next.value

      if (event.type === "permission.v2.asked" && submitted && event.data.sessionID === input.sessionID) {
        await replyPermission(event.data)
        continue
      }
      if (event.type === "question.v2.asked" && submitted && event.data.sessionID === input.sessionID) {
        await rejectQuestion(event.data)
        continue
      }
      if (
        event.type === "form.created" &&
        submitted &&
        (event.data.form.sessionID === input.sessionID ||
          (!input.attached && event.data.form.sessionID === GLOBAL_FORM_SESSION_ID))
      ) {
        await cancelForm(event.data.form)
        continue
      }
      if (!("sessionID" in event.data) || event.data.sessionID !== input.sessionID) continue
      const time = toMillis("created" in event ? event.created : undefined)

      if (event.type === "session.input.promoted") {
        if (event.data.inputID === messageID) {
          promoted = true
          continue
        }
      }
      if (
        event.type === "session.execution.interrupted" &&
        event.data.reason === "user" &&
        (interrupted || permissionRejected || questionRejected || formCancelled)
      ) {
        return
      }
      if (!promoted) continue

      if (event.type === "session.step.started") {
        const part = {
          id: partID(event.id),
          sessionID: input.sessionID,
          messageID: event.data.assistantMessageID,
          type: "step-start",
          snapshot: event.data.snapshot,
        }
        if (!emit("step_start", time, { part }) && input.format !== "json") {
          UI.empty()
          UI.println(`> ${event.data.agent} · ${event.data.model.id}`)
          UI.empty()
        }
        continue
      }

      if (event.type === "session.text.started") {
        starts.set("text", { id: partID(event.id), timestamp: time })
        continue
      }
      if (event.type === "session.text.ended") {
        const started = starts.get("text")
        starts.delete("text")
        const part = {
          id: started?.id ?? partID(event.id),
          sessionID: input.sessionID,
          messageID: event.data.assistantMessageID,
          type: "text",
          text: event.data.text,
          time: { start: started?.timestamp ?? time, end: time },
        }
        writeText(part, time)
        continue
      }

      if (event.type === "session.reasoning.started") {
        starts.set("reasoning", { id: partID(event.id), timestamp: time })
        continue
      }
      if (event.type === "session.reasoning.ended" && input.thinking) {
        const started = starts.get("reasoning")
        starts.delete("reasoning")
        const part = {
          id: started?.id ?? partID(event.id),
          sessionID: input.sessionID,
          messageID: event.data.assistantMessageID,
          type: "reasoning",
          text: event.data.text,
          metadata: event.data.state,
          time: { start: started?.timestamp ?? time, end: time },
        }
        if (emit("reasoning", time, { part })) continue
        const text = part.text.trim()
        if (!text) continue
        const line = `Thinking: ${text}`
        if (!process.stdout.isTTY) {
          process.stdout.write(line + EOL)
          continue
        }
        UI.empty()
        UI.println(`${UI.Style.TEXT_DIM}\u001b[3m${line}\u001b[0m${UI.Style.TEXT_NORMAL}`)
        UI.empty()
        continue
      }

      if (event.type === "session.tool.input.started") {
        tools.set(event.data.callID, {
          id: partID(event.id),
          timestamp: time,
          assistantMessageID: event.data.assistantMessageID,
          tool: event.data.name,
          input: {},
        })
        continue
      }
      if (event.type === "session.tool.input.ended") {
        const current = tools.get(event.data.callID)
        if (current) current.raw = event.data.text
        continue
      }
      if (event.type === "session.tool.called") {
        const current = tools.get(event.data.callID)
        tools.set(event.data.callID, {
          id: current?.id ?? partID(event.id),
          timestamp: current?.timestamp ?? time,
          assistantMessageID: event.data.assistantMessageID,
          tool: current?.tool ?? "tool",
          input: event.data.input,
          raw: current?.raw,
          provider: { executed: event.data.executed, state: event.data.state },
        })
        continue
      }
      if (event.type === "session.tool.success") {
        const current = tools.get(event.data.callID) ?? fallbackTool(event)
        const part: MiniToolPart = {
          id: current.id,
          sessionID: input.sessionID,
          messageID: event.data.assistantMessageID,
          type: "tool",
          callID: event.data.callID,
          tool: current.tool,
          state: {
            status: "completed",
            input: current.input,
            output: event.data.content
              .filter((item) => item.type === "text")
              .map((item) => item.text)
              .join("\n"),
            title: current.tool,
            metadata: {
              structured: event.data.structured,
              content: event.data.content,
              result: event.data.result,
              providerCall: current.provider,
              providerResult: { executed: event.data.executed, state: event.data.resultState },
              rawInput: current.raw,
            },
            time: { start: current.timestamp, end: time },
          },
        }
        tools.delete(event.data.callID)
        if (!emit("tool_use", time, { part })) await input.renderTool(part)
        continue
      }
      if (event.type === "session.tool.failed") {
        const current = tools.get(event.data.callID) ?? fallbackTool(event)
        const error = event.data.error.message
        const part: MiniToolPart = {
          id: current.id,
          sessionID: input.sessionID,
          messageID: event.data.assistantMessageID,
          type: "tool",
          callID: event.data.callID,
          tool: current.tool,
          state: {
            status: "error",
            input: current.input,
            error,
            metadata: {
              result: event.data.result,
              providerCall: current.provider,
              providerResult: { executed: event.data.executed, state: event.data.resultState },
              rawInput: current.raw,
            },
            time: { start: current.timestamp, end: time },
          },
        }
        tools.delete(event.data.callID)
        if (!emit("tool_use", time, { part })) {
          await input.renderToolError(part)
          UI.error(error)
        }
        continue
      }

      if (event.type === "session.step.ended") {
        const part = {
          id: partID(event.id),
          sessionID: input.sessionID,
          messageID: event.data.assistantMessageID,
          type: "step-finish",
          reason: event.data.finish,
          snapshot: event.data.snapshot,
          cost: event.data.cost,
          tokens: event.data.tokens,
        }
        emit("step_finish", time, { part })
        continue
      }
      if (event.type === "session.step.failed") {
        if (interrupted || permissionRejected || questionRejected || formCancelled) continue
        emittedError = true
        process.exitCode = 1
        if (!emit("error", time, { error: event.data.error })) UI.error(event.data.error.message)
        continue
      }
      if (event.type === "session.execution.failed") {
        if (!emittedError && !questionRejected && !formCancelled) {
          emittedError = true
          process.exitCode = 1
          if (!emit("error", time, { error: event.data.error })) UI.error(event.data.error.message)
        }
        return
      }
      if (event.type === "session.execution.interrupted") {
        if (event.data.reason === "user" && interrupted) process.exitCode = 130
        if (event.data.reason !== "user" && !emittedError) {
          emittedError = true
          process.exitCode = 1
          const error = { type: "aborted" as const, message: `Session interrupted: ${event.data.reason}` }
          if (!emit("error", time, { error })) UI.error(error.message)
        }
        return
      }
      if (event.type === "session.execution.succeeded") return
    }
  }

  const interrupt = () => {
    if (interrupted) process.exit(130)
    interrupted = true
    process.exitCode = 130
    admission?.abort()
    void input.client.session.interrupt({ sessionID: input.sessionID }).catch(() => {})
  }
  process.on("SIGINT", interrupt)

  let completed: Promise<void> | undefined
  try {
    if (input.agent) {
      await input.client.session.switchAgent({ sessionID: input.sessionID, agent: input.agent })
    }
    const selected = input.model
      ? { providerID: input.model.providerID, id: input.model.modelID, variant: input.variant }
      : input.variant
        ? await input.client.session
            .get({ sessionID: input.sessionID })
            .then((result) => result.model)
            .then(async (model) => {
              if (model) return { ...model, variant: input.variant }
              const result = await input.client.model.default()
              const fallback = result.data
              return fallback ? { providerID: fallback.providerID, id: fallback.id, variant: input.variant } : undefined
            })
        : undefined
    if (input.variant && !selected) throw new Error("Cannot select a variant before selecting a model")
    if (selected) {
      await input.client.session.switchModel({ sessionID: input.sessionID, model: selected })
    }

    const prepared = await Promise.all(input.files.map(prepareFile))
    if (interrupted) return
    submitted = true
    completed = consume()
    admission = new AbortController()
    const response = await input.client.session
      .prompt(
        {
          sessionID: input.sessionID,
          id: messageID,
          text: [input.message, ...prepared.flatMap((file) => (file.text ? [file.text] : []))].join("\n\n"),
          files: prepared.flatMap((file) => (file.attachment ? [file.attachment] : [])),
          delivery: "steer",
        },
        { signal: admission.signal },
      )
      .catch(async (error) => {
        if (interrupted) {
          await input.client.session.interrupt({ sessionID: input.sessionID }).catch(() => {})
        }
        controller.abort()
        await completed?.catch(() => {})
        if (interrupted || emittedError) return undefined
        throw error
      })
    admission = undefined
    if (!response) return
    if (interrupted) await input.client.session.interrupt({ sessionID: input.sessionID }).catch(() => {})

    const [permissions, questions, forms] = await Promise.all([
      input.client.permission.list({ sessionID: input.sessionID }).catch(() => undefined),
      input.client.question.list({ sessionID: input.sessionID }).catch(() => undefined),
      Promise.all(
        (input.attached ? [input.sessionID] : [input.sessionID, GLOBAL_FORM_SESSION_ID]).map((sessionID) =>
          input.client.form.list({ sessionID }).catch(() => undefined),
        ),
      ),
    ])
    await Promise.all([
      ...(permissions ?? []).map(replyPermission),
      ...(questions ?? []).map(rejectQuestion),
      ...forms.flatMap((response) => response ?? []).map(cancelForm),
    ])
    await completed
  } finally {
    process.off("SIGINT", interrupt)
    controller.abort()
    await stream.return?.(undefined).catch(() => {})
  }
}

function partID(eventID: string) {
  return `prt_${eventID.replace(/^evt_/, "")}`
}

function fallbackTool(event: {
  id: string
  created: number
  data: { assistantMessageID: string; callID: string }
}): ToolState {
  return {
    id: partID(event.id),
    timestamp: toMillis(event.created),
    assistantMessageID: event.data.assistantMessageID,
    tool: "tool",
    input: {},
  }
}

function toMillis(value: unknown) {
  if (typeof value === "number") return value
  if (typeof value === "string") return new Date(value).getTime()
  return Date.now()
}

async function prepareFile(file: File) {
  if (file.mime !== "text/plain") {
    const uri = file.url.startsWith("data:")
      ? file.url
      : `data:${file.mime};base64,${Buffer.from(await Bun.file(new URL(file.url)).arrayBuffer()).toString("base64")}`
    return { attachment: { uri, mime: file.mime, name: file.filename } }
  }
  const content = file.url.startsWith("data:")
    ? Buffer.from(file.url.slice(file.url.indexOf(",") + 1), "base64").toString("utf8")
    : await Bun.file(new URL(file.url)).text()
  return { text: `<file name="${file.filename}">\n${content}\n</file>` }
}

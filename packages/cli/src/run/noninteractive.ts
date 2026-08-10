import type {
  EventSubscribeOutput,
  JsonValue,
  LocationRef,
  OpenCodeClient,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  ToolContent,
} from "@opencode-ai/client/promise"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { EOL } from "node:os"
import { readFile } from "node:fs/promises"
import { nonEmptyToolContent, toolOutputText, type MiniToolPart } from "@opencode-ai/tui/mini/tool"
import { UI } from "./ui"

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
  location: LocationRef
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
  compatibility?: "v1"
  renderTool: (part: SessionMessageAssistantTool) => Promise<void>
  renderToolError: (part: SessionMessageAssistantTool) => Promise<void>
}

type StartedPart = {
  id: string
  timestamp: number
}

type ToolState = StartedPart & {
  assistantMessageID: string
  tool: string
  input: Record<string, JsonValue>
  raw?: string
  provider?: unknown
  providerState?: SessionMessageAssistantTool["providerState"]
  metadata: Record<string, JsonValue>
  content: ToolContent[]
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
  const renderedText = new Map<string, string>()
  const renderedReasoning = new Map<string, string>()
  const renderedTools = new Set<string>()
  let submitted = false
  let promoted = false
  let emittedError = false
  let permissionRejected = false
  let formCancelled = false
  let interrupted = false
  let v1InvalidOutput = false
  let prePromotionError: { message: string; [key: string]: unknown } | undefined
  let finalizing = false
  let admission: AbortController | undefined
  let pendingStep: { timestamp: number; part: Record<string, unknown>; label: string } | undefined

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

  const writeReasoning = (part: { text: string; [key: string]: unknown }, timestamp: number) => {
    if (emit("reasoning", timestamp, { part })) return
    const text = part.text.trim()
    if (!text) return
    const line = `Thinking: ${text}`
    if (!process.stdout.isTTY) return void process.stdout.write(line + EOL)
    UI.empty()
    UI.println(`${UI.Style.TEXT_DIM}\u001b[3m${line}\u001b[0m${UI.Style.TEXT_NORMAL}`)
    UI.empty()
  }

  const flushStep = () => {
    if (!pendingStep) return
    const value = pendingStep
    pendingStep = undefined
    if (!emit("step_start", value.timestamp, { part: value.part }) && input.format !== "json") {
      UI.empty()
      UI.println(value.label)
      UI.empty()
    }
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

  const cancelForm = async (request: Pick<FormRequest, "id" | "sessionID">) => {
    try {
      await input.client.form.cancel(
        { sessionID: request.sessionID, formID: request.id },
        ...formRequestOptions(request.sessionID === GLOBAL_FORM_SESSION_ID ? input.location : undefined),
      )
    } catch (error) {
      if (!formAlreadySettled(error)) throw error
    }
    formCancelled = true
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

      if (event.type === "permission.asked" && submitted && event.data.sessionID === input.sessionID) {
        await replyPermission(event.data)
        continue
      }
      if (
        event.type === "form.created" &&
        submitted &&
        (event.data.form.sessionID === input.sessionID ||
          (!input.attached &&
            event.data.form.sessionID === GLOBAL_FORM_SESSION_ID &&
            sameLocation(event.location, input.location)))
      ) {
        await cancelForm(event.data.form)
        continue
      }
      if (!("sessionID" in event.data) || event.data.sessionID !== input.sessionID) continue
      const time = toMillis("created" in event ? event.created : undefined)

      if (event.type === "session.input.promoted") {
        if (event.data.inputID === messageID) {
          promoted = true
          prePromotionError = undefined
          continue
        }
      }
      if (
        event.type === "session.execution.interrupted" &&
        event.data.reason === "user" &&
        (interrupted || permissionRejected || formCancelled)
      ) {
        return
      }
      if (!promoted && event.type === "session.execution.failed") {
        prePromotionError = event.data.error
        if (finalizing) return
        continue
      }
      if (
        !promoted &&
        finalizing &&
        (event.type === "session.execution.succeeded" || event.type === "session.execution.interrupted")
      )
        return
      if (!promoted) continue
      if (finalizing && !event.type.startsWith("session.execution.")) continue

      if (event.type === "session.step.started") {
        const part = {
          id: partID(event.id),
          sessionID: input.sessionID,
          messageID: event.data.assistantMessageID,
          type: "step-start",
          snapshot: event.data.snapshot,
        }
        if (input.compatibility === "v1") {
          pendingStep = {
            timestamp: time,
            part,
            label: `> ${event.data.agent} · ${event.data.model.id}`,
          }
          continue
        }
        if (!emit("step_start", time, { part }) && input.format !== "json") {
          UI.empty()
          UI.println(`> ${event.data.agent} · ${event.data.model.id}`)
          UI.empty()
        }
        continue
      }

      if (event.type === "session.text.started") {
        flushStep()
        starts.set(`text\u0000${contentKey(event.data.assistantMessageID, event.data.ordinal)}`, {
          id: partID(event.id),
          timestamp: time,
        })
        continue
      }
      if (event.type === "session.text.ended") {
        const key = contentKey(event.data.assistantMessageID, event.data.ordinal)
        const started = starts.get(`text\u0000${key}`)
        starts.delete(`text\u0000${key}`)
        const part = {
          id: started?.id ?? partID(event.id),
          sessionID: input.sessionID,
          messageID: event.data.assistantMessageID,
          type: "text",
          text: event.data.text,
          time: { start: started?.timestamp ?? time, end: time },
        }
        renderedText.set(key, event.data.text)
        writeText(part, time)
        continue
      }

      if (event.type === "session.reasoning.started") {
        flushStep()
        starts.set(`reasoning\u0000${contentKey(event.data.assistantMessageID, event.data.ordinal)}`, {
          id: partID(event.id),
          timestamp: time,
        })
        continue
      }
      if (event.type === "session.reasoning.ended" && input.thinking) {
        const key = contentKey(event.data.assistantMessageID, event.data.ordinal)
        const started = starts.get(`reasoning\u0000${key}`)
        starts.delete(`reasoning\u0000${key}`)
        const part = {
          id: started?.id ?? partID(event.id),
          sessionID: input.sessionID,
          messageID: event.data.assistantMessageID,
          type: "reasoning",
          text: event.data.text,
          metadata: event.data.state,
          time: { start: started?.timestamp ?? time, end: time },
        }
        renderedReasoning.set(key, event.data.text)
        writeReasoning(part, time)
        continue
      }

      if (event.type === "session.tool.input.started") {
        flushStep()
        tools.set(toolKey(event.data.assistantMessageID, event.data.id), {
          id: partID(event.id),
          timestamp: time,
          assistantMessageID: event.data.assistantMessageID,
          tool: event.data.name,
          input: {},
          metadata: {},
          content: [],
        })
        continue
      }
      if (event.type === "session.tool.input.ended") {
        const current = tools.get(toolKey(event.data.assistantMessageID, event.data.id))
        if (current) current.raw = event.data.text
        continue
      }
      if (event.type === "session.tool.input.delta") {
        const current = tools.get(toolKey(event.data.assistantMessageID, event.data.id))
        if (current) current.raw = (current.raw ?? "") + event.data.delta
        continue
      }
      if (event.type === "session.tool.called") {
        flushStep()
        const key = toolKey(event.data.assistantMessageID, event.data.id)
        const current = tools.get(key)
        tools.set(key, {
          id: current?.id ?? partID(event.id),
          timestamp: current?.timestamp ?? time,
          assistantMessageID: event.data.assistantMessageID,
          tool: current?.tool ?? "tool",
          input: event.data.input,
          raw: current?.raw,
          provider: { executed: event.data.executed, state: event.data.state },
          providerState: event.data.state,
          metadata: {},
          content: [],
        })
        continue
      }
      if (event.type === "session.tool.progress") {
        const current = tools.get(toolKey(event.data.assistantMessageID, event.data.id))
        if (current) {
          current.metadata = event.data.metadata
        }
        continue
      }
      if (event.type === "session.tool.success") {
        const key = toolKey(event.data.assistantMessageID, event.data.id)
        const current = tools.get(key) ?? fallbackTool(event)
        const tool: SessionMessageAssistantTool = {
          type: "tool",
          id: event.data.id,
          name: current.tool,
          executed: event.data.executed,
          providerState: current.providerState,
          providerResultState: event.data.resultState,
          state: {
            status: "completed",
            input: current.input,
            metadata: event.data.metadata,
            content: event.data.content,
          },
          time: { created: current.timestamp, ran: current.timestamp, completed: time },
        }
        const part: MiniToolPart = {
          partID: current.id,
          sessionID: input.sessionID,
          messageID: event.data.assistantMessageID,
          type: "tool",
          id: event.data.id,
          tool: current.tool,
          state: {
            status: "completed",
            input: current.input,
            output: toolOutputText(current.tool, event.data.content),
            title: current.tool,
            metadata: {
              metadata: event.data.metadata,
              content: event.data.content,
              providerCall: current.provider,
              providerResult: { executed: event.data.executed, state: event.data.resultState },
              rawInput: current.raw,
            },
            time: { start: current.timestamp, end: time },
          },
        }
        tools.delete(key)
        renderedTools.add(key)
        if (!emit("tool_use", time, { part })) await input.renderTool(tool)
        continue
      }
      if (event.type === "session.tool.failed") {
        const key = toolKey(event.data.assistantMessageID, event.data.id)
        const current = tools.get(key) ?? fallbackTool(event)
        const error = event.data.error.message
        const metadata = event.data.metadata ?? current.metadata
        const content = event.data.content ?? nonEmptyToolContent(current.content)
        const tool: SessionMessageAssistantTool = {
          type: "tool",
          id: event.data.id,
          name: current.tool,
          executed: event.data.executed,
          providerState: current.providerState,
          providerResultState: event.data.resultState,
          state: {
            status: "error",
            input: current.input,
            metadata,
            content,
            error: event.data.error,
          },
          time: { created: current.timestamp, ran: current.timestamp, completed: time },
        }
        const part: MiniToolPart = {
          partID: current.id,
          sessionID: input.sessionID,
          messageID: event.data.assistantMessageID,
          type: "tool",
          id: event.data.id,
          tool: current.tool,
          state: {
            status: "error",
            input: current.input,
            error,
            metadata: {
              providerCall: current.provider,
              providerResult: { executed: event.data.executed, state: event.data.resultState },
              rawInput: current.raw,
            },
            time: { start: current.timestamp, end: time },
          },
        }
        tools.delete(key)
        renderedTools.add(key)
        if (input.compatibility === "v1" && (permissionRejected || formCancelled)) continue
        if (!emit("tool_use", time, { part })) {
          if (content && toolOutputText(current.tool, content).trim())
            await input.renderTool({
              ...tool,
              state: {
                status: "completed",
                input: current.input,
                metadata,
                content,
              },
            })
          await input.renderToolError(tool)
          UI.error(error)
        }
        continue
      }

      if (event.type === "session.step.ended") {
        flushStep()
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
        if (input.compatibility === "v1" && event.data.error.message === "The provider response ended unexpectedly.") {
          pendingStep = undefined
          v1InvalidOutput = true
          continue
        }
        if (interrupted || permissionRejected || formCancelled) continue
        flushStep()
        emittedError = true
        process.exitCode = 1
        if (!emit("error", time, { error: event.data.error })) UI.error(event.data.error.message)
        continue
      }
      if (event.type === "session.execution.failed") {
        if (input.compatibility === "v1" && (v1InvalidOutput || permissionRejected || formCancelled)) return
        flushStep()
        if (!emittedError && !formCancelled) {
          emittedError = true
          process.exitCode = 1
          if (!emit("error", time, { error: event.data.error })) UI.error(event.data.error.message)
        }
        return
      }
      if (event.type === "session.execution.interrupted") {
        if (input.compatibility === "v1" && (permissionRejected || formCancelled)) return
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

  const projectedMessages = async () => {
    const messages: SessionMessageInfo[] = []
    let cursor: string | undefined
    while (true) {
      const page = await input.client.message.list(
        cursor
          ? { sessionID: input.sessionID, limit: 200, cursor }
          : { sessionID: input.sessionID, limit: 200, order: "desc" },
      )
      for (const message of page.data) {
        if (message.id === messageID) return { found: true, messages: messages.toReversed() }
        messages.push(message)
      }
      cursor = page.cursor.next ?? undefined
      if (!cursor) return { found: false, messages: [] }
    }
  }

  const reconcile = async () => {
    const projected = await projectedMessages()
    for (const message of projected.messages) {
      if (message.type !== "assistant") continue
      const timestamp = message.time.completed ?? message.time.created
      let textOrdinal = 0
      let reasoningOrdinal = 0
      for (const item of message.content) {
        if (item.type === "text") {
          const ordinal = textOrdinal++
          const key = contentKey(message.id, ordinal)
          const rendered = renderedText.get(key) ?? ""
          if (rendered === item.text || !item.text.startsWith(rendered)) continue
          const text = item.text.slice(rendered.length)
          writeText(
            {
              id: projectedPartID(message.id, `text-${ordinal}`),
              sessionID: input.sessionID,
              messageID: message.id,
              type: "text",
              text,
              time: { start: message.time.created, end: timestamp },
            },
            timestamp,
          )
          renderedText.set(key, item.text)
          continue
        }
        if (item.type === "reasoning") {
          const ordinal = reasoningOrdinal++
          if (!input.thinking) continue
          const key = contentKey(message.id, ordinal)
          const rendered = renderedReasoning.get(key) ?? ""
          if (rendered === item.text || !item.text.startsWith(rendered)) continue
          const text = item.text.slice(rendered.length)
          const part = {
            id: projectedPartID(message.id, `reasoning-${ordinal}`),
            sessionID: input.sessionID,
            messageID: message.id,
            type: "reasoning",
            text,
            metadata: item.state,
            time: { start: message.time.created, end: timestamp },
          }
          renderedReasoning.set(key, item.text)
          writeReasoning(part, timestamp)
          continue
        }

        const key = toolKey(message.id, item.id)
        if (renderedTools.has(key) || item.state.status === "streaming" || item.state.status === "running") continue
        const part: MiniToolPart = {
          partID: projectedPartID(message.id, `tool-${item.id}`),
          sessionID: input.sessionID,
          messageID: message.id,
          type: "tool",
          id: item.id,
          tool: item.name,
          state:
            item.state.status === "completed"
              ? {
                  status: "completed",
                  input: item.state.input,
                  output: toolOutputText(item.name, item.state.content),
                  title: item.name,
                  metadata: { metadata: item.state.metadata, content: item.state.content },
                  time: { start: item.time.ran ?? item.time.created, end: item.time.completed ?? timestamp },
                }
              : {
                  status: "error",
                  input: item.state.input,
                  error: item.state.error.message,
                  metadata: { metadata: item.state.metadata, content: item.state.content },
                  time: { start: item.time.ran ?? item.time.created, end: item.time.completed ?? timestamp },
                },
        }
        renderedTools.add(key)
        if (emit("tool_use", timestamp, { part })) continue
        if (item.state.status === "completed") {
          await input.renderTool(item)
          continue
        }
        if (item.state.content && toolOutputText(item.name, item.state.content).trim()) {
          await input.renderTool({
            ...item,
            state: {
              status: "completed",
              input: item.state.input,
              metadata: item.state.metadata,
              content: item.state.content,
            },
          })
        }
        await input.renderToolError(item)
        UI.error(item.state.error.message)
      }

      if (message.error && !emittedError) {
        emittedError = true
        process.exitCode = 1
        if (!emit("error", timestamp, { error: message.error })) UI.error(message.error.message)
      }
    }
    return {
      found: projected.found,
      responded: projected.messages.some((message) => message.type === "assistant"),
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

    const [permissions, forms, globals] = await Promise.all([
      input.client.permission.list({ sessionID: input.sessionID }).catch(() => undefined),
      input.client.form.list({ sessionID: input.sessionID }).catch(() => undefined),
      input.attached
        ? Promise.resolve(undefined)
        : input.client.form.request
            .list({
              location: { directory: input.location.directory, workspace: input.location.workspaceID },
            })
            .catch(() => undefined),
    ])
    await Promise.all([
      ...(permissions ?? []).map(replyPermission),
      ...(forms ?? []).map(cancelForm),
      ...(globals && sameLocation(globals.location, input.location)
        ? globals.data.filter((form) => form.sessionID === GLOBAL_FORM_SESSION_ID).map(cancelForm)
        : []),
    ])
    if (input.compatibility === "v1") {
      await completed
      return
    }

    const waiting = input.client.session.wait({ sessionID: input.sessionID })
    await Promise.race([waiting, completed.then(() => waiting)])
    finalizing = true
    const projected = await reconcile()
    if (
      !projected.responded &&
      !interrupted &&
      !permissionRejected &&
      !formCancelled &&
      !emittedError &&
      !prePromotionError
    ) {
      await completed
    }
    if (!projected.found && !interrupted && !permissionRejected && !formCancelled && !emittedError) {
      const error = prePromotionError ?? { type: "unknown", message: "Prompt was not promoted" }
      emittedError = true
      process.exitCode = 1
      if (!emit("error", Date.now(), { error })) UI.error(error.message)
    }
  } finally {
    process.off("SIGINT", interrupt)
    controller.abort()
    if (input.compatibility === "v1") await stream.return?.(undefined).catch(() => {})
    else void stream.return?.(undefined).catch(() => {})
  }
}

function sameLocation(left: LocationRef | undefined, right: LocationRef) {
  return !!left && left.directory === right.directory && left.workspaceID === right.workspaceID
}

function formRequestOptions(location: LocationRef | undefined): [] | [{ headers: Record<string, string> }] {
  if (!location) return []
  return [
    {
      headers: {
        "x-opencode-directory": encodeURIComponent(location.directory),
        ...(location.workspaceID ? { "x-opencode-workspace": location.workspaceID } : {}),
      },
    },
  ]
}

function formAlreadySettled(error: unknown) {
  return !!error && typeof error === "object" && Reflect.get(error, "_tag") === "FormAlreadySettledError"
}

function partID(eventID: string) {
  return `prt_${eventID.replace(/^evt_/, "")}`
}

function toolKey(messageID: string, id: string) {
  return `${messageID}\u0000${id}`
}

function contentKey(messageID: string, ordinal: number) {
  return `${messageID}\u0000${ordinal}`
}

function projectedPartID(messageID: string, part: string) {
  return `prt_${messageID.replace(/^msg_/, "")}_${part}`
}

function fallbackTool(event: {
  id: string
  created: number
  data: { assistantMessageID: string; id: string }
}): ToolState {
  return {
    id: partID(event.id),
    timestamp: toMillis(event.created),
    assistantMessageID: event.data.assistantMessageID,
    tool: "tool",
    input: {},
    metadata: {},
    content: [],
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
      : `data:${file.mime};base64,${(await readFile(new URL(file.url))).toString("base64")}`
    return { attachment: { uri, name: file.filename } }
  }
  const content = file.url.startsWith("data:")
    ? Buffer.from(file.url.slice(file.url.indexOf(",") + 1), "base64").toString("utf8")
    : await readFile(new URL(file.url), "utf8")
  return { text: `<file name="${file.filename}">\n${content}\n</file>` }
}

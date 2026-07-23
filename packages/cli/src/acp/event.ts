import type {
  AgentSideConnection,
  CreateElicitationRequest,
  ElicitationPropertySchema,
  PromptResponse,
} from "@agentclientprotocol/sdk"
import type {
  EventSubscribeOutput,
  FormField,
  FormInfo,
  OpenCodeClient,
  SessionMessageAssistant,
  SessionMessageInfo,
} from "@opencode-ai/client/promise"
import { partsToContentChunks, type ReplayPart } from "./content"
import { ACPError } from "./error"
import { replyPermission, syncEditedFiles } from "./permission"
import {
  completedToolUpdate,
  errorToolUpdate,
  pendingToolCall,
  runningToolUpdate,
  type ToolContent,
  type ToolInput,
} from "./tool"

type Connection = Pick<AgentSideConnection, "sessionUpdate" | "requestPermission"> &
  Partial<Pick<AgentSideConnection, "writeTextFile" | "unstable_createElicitation">>

export type TurnControl = {
  cancelled: boolean
  readonly admission: AbortController
}

type ToolState = {
  readonly name: string
  input: ToolInput
  structured: Record<string, unknown>
  content: ToolContent
}

export type TurnStart =
  | { readonly type: "input"; readonly id: string }
  | { readonly type: "skill"; readonly id: string }
  | { readonly type: "compaction"; readonly id: string }

function emptyToolState(): ToolState {
  return { name: "tool", input: {}, structured: {}, content: [] }
}

export async function streamTurn(input: {
  readonly client: OpenCodeClient
  readonly connection: Connection
  readonly sessionID: string
  readonly cwd: string
  readonly start: TurnStart
  readonly userMessageID?: string | null
  readonly elicitation: boolean
  readonly submit: (signal: AbortSignal) => Promise<unknown>
  readonly control: TurnControl
}): Promise<PromptResponse> {
  const streamController = new AbortController()
  const stream = input.client.event.subscribe({ signal: streamController.signal })[Symbol.asyncIterator]()
  const connected = await stream.next()
  if (connected.done) throw new Error("event stream disconnected before prompt admission")

  const control = input.control
  let started = false
  let assistantMessageID: string | undefined
  let finish: SessionMessageAssistant["finish"]
  let executionError: { readonly type: string; readonly message: string } | undefined
  const tools = new Map<string, ToolState>()

  const update = (value: Parameters<Connection["sessionUpdate"]>[0]["update"]) =>
    input.connection.sessionUpdate({ sessionId: input.sessionID, update: value })

  const consume = async () => {
    while (!streamController.signal.aborted) {
      const next = await stream.next()
      if (next.done) throw new Error("event stream disconnected during prompt execution")
      const event = next.value
      if (event.type === "permission.v2.asked" && event.data.sessionID === input.sessionID) {
        const tool = event.data.source?.callID ? tools.get(event.data.source.callID) : undefined
        await replyPermission({
          client: input.client,
          connection: input.connection,
          event,
          sessionID: input.sessionID,
          cwd: input.cwd,
          tool,
        })
        continue
      }
      if (event.type === "form.created" && event.data.form.sessionID === input.sessionID) {
        await replyForm({
          client: input.client,
          connection: input.connection,
          form: event.data.form,
          elicitation: input.elicitation,
        })
          .catch(() => input.client.session.interrupt({ sessionID: input.sessionID }).catch(() => {}))
        continue
      }
      if (!("sessionID" in event.data) || event.data.sessionID !== input.sessionID) continue
      if (matchesStart(event, input.start)) {
        started = true
        continue
      }
      if (!started) continue

      if (event.type === "session.step.started") {
        assistantMessageID = event.data.assistantMessageID
        continue
      }
      if (event.type === "session.text.delta") {
        assistantMessageID = event.data.assistantMessageID
        await update({
          sessionUpdate: "agent_message_chunk",
          messageId: event.data.assistantMessageID,
          content: { type: "text", text: event.data.delta },
        })
        continue
      }
      if (event.type === "session.reasoning.delta") {
        assistantMessageID = event.data.assistantMessageID
        await update({
          sessionUpdate: "agent_thought_chunk",
          messageId: event.data.assistantMessageID,
          content: { type: "text", text: event.data.delta },
        })
        continue
      }
      if (event.type === "session.tool.input.started") {
        assistantMessageID = event.data.assistantMessageID
        tools.set(event.data.callID, { name: event.data.name, input: {}, structured: {}, content: [] })
        await update({
          sessionUpdate: "tool_call",
          ...pendingToolCall({
            toolCallId: event.data.callID,
            toolName: event.data.name,
            state: { input: {} },
            cwd: input.cwd,
          }),
        })
        continue
      }
      if (event.type === "session.tool.called") {
        assistantMessageID = event.data.assistantMessageID
        const current = tools.get(event.data.callID) ?? emptyToolState()
        current.input = event.data.input
        tools.set(event.data.callID, current)
        await update({
          sessionUpdate: "tool_call_update",
          ...runningToolUpdate({
            toolCallId: event.data.callID,
            toolName: current.name,
            state: { input: current.input },
            cwd: input.cwd,
          }),
        })
        continue
      }
      if (event.type === "session.tool.progress") {
        const current = tools.get(event.data.callID)
        if (!current) continue
        current.structured = event.data.structured
        current.content = event.data.content
        await update({
          sessionUpdate: "tool_call_update",
          ...runningToolUpdate({
            toolCallId: event.data.callID,
            toolName: current.name,
            state: { input: current.input },
            content: current.content,
            cwd: input.cwd,
          }),
        })
        continue
      }
      if (event.type === "session.tool.success") {
        const current = tools.get(event.data.callID) ?? emptyToolState()
        tools.delete(event.data.callID)
        await syncEditedFiles({
          connection: input.connection,
          sessionID: input.sessionID,
          cwd: input.cwd,
          toolName: current.name,
          toolInput: current.input,
          structured: event.data.structured,
        }).catch(() => {})
        await update({
          sessionUpdate: "tool_call_update",
          ...completedToolUpdate({
            toolCallId: event.data.callID,
            toolName: current.name,
            input: current.input,
            structured: event.data.structured,
            content: event.data.content,
            result: event.data.result,
          }),
        })
        continue
      }
      if (event.type === "session.tool.failed") {
        const current = tools.get(event.data.callID) ?? emptyToolState()
        tools.delete(event.data.callID)
        await update({
          sessionUpdate: "tool_call_update",
          ...errorToolUpdate({
            toolCallId: event.data.callID,
            toolName: current.name,
            input: current.input,
            structured: event.data.metadata ?? current.structured,
            content: event.data.content ?? current.content,
            error: event.data.error.message,
            cwd: input.cwd,
          }),
        })
        continue
      }
      if (event.type === "session.step.ended") {
        assistantMessageID = event.data.assistantMessageID
        finish = event.data.finish
        continue
      }
      if (event.type === "session.execution.succeeded") return "succeeded" as const
      if (event.type === "session.execution.interrupted") return "interrupted" as const
      if (event.type === "session.execution.failed") {
        executionError = event.data.error
        return "failed" as const
      }
    }
    return "interrupted" as const
  }

  const completed = consume()
  try {
    await input.submit(control.admission.signal).catch((error) => {
      if (!control.cancelled) throw error
    })
    if (control.cancelled) {
      await input.client.session.interrupt({ sessionID: input.sessionID }).catch(() => {})
      if (!started) {
        streamController.abort()
        await completed.catch(() => {})
        return response(undefined, undefined, "interrupted", true, undefined, input.userMessageID)
      }
    }
    const terminal = await completed
    const assistant = assistantMessageID
      ? await input.client.session
          .message({ sessionID: input.sessionID, messageID: assistantMessageID })
          .catch(() => undefined)
      : undefined
    return response(
      assistant?.type === "assistant" ? assistant : undefined,
      executionError,
      terminal,
      control.cancelled,
      finish,
      input.userMessageID,
    )
  } catch (error) {
    streamController.abort()
    await completed.catch(() => {})
    throw error
  } finally {
    streamController.abort()
    await stream.return?.(undefined).catch(() => {})
  }
}

async function replyForm(input: {
  readonly client: OpenCodeClient
  readonly connection: Connection
  readonly form: FormInfo
  readonly elicitation: boolean
}) {
  const request = input.elicitation ? formRequest(input.form) : undefined
  if (!request || !input.connection.unstable_createElicitation) {
    return input.client.form.cancel({ sessionID: input.form.sessionID, formID: input.form.id })
  }
  const response = await input.connection.unstable_createElicitation(request).catch(() => undefined)
  if (!response || response.action !== "accept") {
    return input.client.form.cancel({ sessionID: input.form.sessionID, formID: input.form.id })
  }
  await input.client.form
    .reply({ sessionID: input.form.sessionID, formID: input.form.id, answer: response.content ?? {} })
    .catch(() => input.client.form.cancel({ sessionID: input.form.sessionID, formID: input.form.id }))
}

function formRequest(form: FormInfo): CreateElicitationRequest | undefined {
  const properties = form.fields
    .map((field) => [field.key, formProperty(field)] as const)
    .filter((entry): entry is readonly [string, ElicitationPropertySchema] => entry[1] !== undefined)
  if (properties.length !== form.fields.length) return undefined
  const toolCallID = questionToolCallID(form.metadata)
  return {
    sessionId: form.sessionID,
    ...(toolCallID ? { toolCallId: toolCallID } : {}),
    mode: "form",
    message: form.title,
    requestedSchema: {
      type: "object",
      title: form.title,
      properties: Object.fromEntries(properties),
      required: form.fields.filter((field) => field.type !== "external" && field.required).map((field) => field.key),
    },
  }
}

function formProperty(field: FormField): ElicitationPropertySchema | undefined {
  if (field.type === "external" || field.when?.length) return undefined
  const base = {
    ...(field.title ? { title: field.title } : {}),
    ...(field.description ? { description: field.description } : {}),
  }
  if (field.type === "string") {
    return {
      ...base,
      type: "string",
      ...(field.format ? { format: field.format } : {}),
      ...(field.minLength === undefined ? {} : { minLength: field.minLength }),
      ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
      ...(field.pattern === undefined ? {} : { pattern: field.pattern }),
      ...(field.default === undefined ? {} : { default: field.default }),
      ...(field.options?.length
        ? {
            oneOf: field.options.map((option) => ({
              const: option.value,
              title: option.label,
              ...(option.description ? { description: option.description } : {}),
            })),
          }
        : {}),
    }
  }
  if (field.type === "number" || field.type === "integer") {
    if (
      [field.minimum, field.maximum, field.default].some(
        (value) => value !== undefined && (typeof value !== "number" || !Number.isFinite(value)),
      )
    )
      return undefined
    const constraints = {
      ...base,
      ...(typeof field.minimum === "number" ? { minimum: field.minimum } : {}),
      ...(typeof field.maximum === "number" ? { maximum: field.maximum } : {}),
      ...(typeof field.default === "number" ? { default: field.default } : {}),
    }
    if (field.type === "number") return { ...constraints, type: "number" }
    return { ...constraints, type: "integer" }
  }
  if (field.type === "boolean") {
    return {
      ...base,
      type: "boolean",
      ...(field.default === undefined ? {} : { default: field.default }),
    }
  }
  return {
    ...base,
    type: "array",
    items: {
      anyOf: field.options.map((option) => ({
        const: option.value,
        title: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
    },
    ...(field.minItems === undefined ? {} : { minItems: field.minItems }),
    ...(field.maxItems === undefined ? {} : { maxItems: field.maxItems }),
    ...(field.default === undefined ? {} : { default: field.default }),
  }
}

function questionToolCallID(metadata: FormInfo["metadata"]) {
  if (!metadata) return undefined
  const tool = metadata.tool
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return undefined
  return typeof tool.callID === "string" ? tool.callID : undefined
}

export async function replayMessages(
  connection: Pick<AgentSideConnection, "sessionUpdate">,
  sessionID: string,
  cwd: string,
  messages: readonly SessionMessageInfo[],
) {
  for (const message of messages) await replayMessage(connection, sessionID, cwd, message).catch(() => {})
}

async function replayMessage(
  connection: Pick<AgentSideConnection, "sessionUpdate">,
  sessionID: string,
  cwd: string,
  message: SessionMessageInfo,
) {
  if (message.type === "user") {
    await connection.sessionUpdate({
      sessionId: sessionID,
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: message.id,
        content: { type: "text", text: message.text },
      },
    })
    const files: ReplayPart[] = (message.files ?? []).map((file) => ({
      type: "file",
      url: file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`,
      filename: file.name,
      mime: file.mime,
    }))
    for (const chunk of partsToContentChunks(files)) {
      await connection.sessionUpdate({
        sessionId: sessionID,
        update: { sessionUpdate: "user_message_chunk", messageId: message.id, ...chunk },
      })
    }
    return
  }
  if (message.type !== "assistant") return
  for (const part of message.content) {
    if (part.type === "text") {
      await connection.sessionUpdate({
        sessionId: sessionID,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: message.id,
          content: { type: "text", text: part.text },
        },
      })
      continue
    }
    if (part.type === "reasoning") {
      await connection.sessionUpdate({
        sessionId: sessionID,
        update: {
          sessionUpdate: "agent_thought_chunk",
          messageId: message.id,
          content: { type: "text", text: part.text },
        },
      })
      continue
    }
    await connection.sessionUpdate({
      sessionId: sessionID,
      update: {
        sessionUpdate: "tool_call",
        ...pendingToolCall({
          toolCallId: part.id,
          toolName: part.name,
          state: { input: part.state.status === "streaming" ? {} : part.state.input },
          cwd,
        }),
      },
    })
    switch (part.state.status) {
      case "completed":
        await connection.sessionUpdate({
          sessionId: sessionID,
          update: {
            sessionUpdate: "tool_call_update",
            ...completedToolUpdate({
              toolCallId: part.id,
              toolName: part.name,
              input: part.state.input,
              structured: part.state.structured,
              content: part.state.content,
              result: part.state.result,
            }),
          },
        })
        break
      case "running":
        await connection.sessionUpdate({
          sessionId: sessionID,
          update: {
            sessionUpdate: "tool_call_update",
            ...runningToolUpdate({
              toolCallId: part.id,
              toolName: part.name,
              state: { input: part.state.input },
              content: part.state.content,
              cwd,
            }),
          },
        })
        break
      case "error":
        await connection.sessionUpdate({
          sessionId: sessionID,
          update: {
            sessionUpdate: "tool_call_update",
            ...errorToolUpdate({
              toolCallId: part.id,
              toolName: part.name,
              input: part.state.input,
              structured: part.state.structured,
              content: part.state.content,
              error: part.state.error.message,
              cwd,
            }),
          },
        })
        break
      case "streaming":
        break
    }
  }
}

function matchesStart(event: EventSubscribeOutput, start: TurnStart) {
  if (start.type === "input") return event.type === "session.input.promoted" && event.data.inputID === start.id
  if (start.type === "compaction")
    return event.type === "session.compaction.admitted" && event.data.inputID === start.id
  return event.type === "session.skill.activated" && event.id === start.id.replace(/^msg_/, "evt_")
}

function response(
  assistant: SessionMessageAssistant | undefined,
  executionError: { readonly type: string; readonly message: string } | undefined,
  terminal: "succeeded" | "failed" | "interrupted",
  cancelled: boolean,
  finish: SessionMessageAssistant["finish"],
  messageID: string | null | undefined,
): PromptResponse {
  const error = assistant?.error ?? executionError
  if (error?.type === "provider.auth") throw new ACPError.AuthRequiredError()
  if (error && error.type !== "aborted" && error.type !== "provider.content-filter") {
    throw new ACPError.ServiceFailureError({
      safeMessage: error.message || "OpenCode prompt failed",
      service: "session",
      errorName: error.type,
    })
  }
  const tokens = assistant?.tokens
  const usage = tokens
    ? {
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        totalTokens: tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write,
        ...(tokens.reasoning > 0 ? { thoughtTokens: tokens.reasoning } : {}),
        ...(tokens.cache.read > 0 ? { cachedReadTokens: tokens.cache.read } : {}),
        ...(tokens.cache.write > 0 ? { cachedWriteTokens: tokens.cache.write } : {}),
      }
    : undefined
  const stopReason = resolveStopReason({ terminal, cancelled, finish, error: error?.type })
  return { stopReason, ...(usage ? { usage } : {}), ...(messageID ? { userMessageId: messageID } : {}), _meta: {} }
}

function resolveStopReason(input: {
  readonly terminal: "succeeded" | "failed" | "interrupted"
  readonly cancelled: boolean
  readonly finish: SessionMessageAssistant["finish"]
  readonly error?: string
}): PromptResponse["stopReason"] {
  if (input.cancelled || input.terminal === "interrupted" || input.error === "aborted") return "cancelled"
  if (input.finish === "length") return "max_tokens"
  if (input.finish === "content-filter" || input.error === "provider.content-filter") return "refusal"
  return "end_turn"
}

export * as ACPEvent from "./event"

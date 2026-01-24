import {
  ClientFactory,
  ClientFactoryOptions,
  Client,
  type RequestOptions,
} from "@a2a-js/sdk/client"
import type {
  AgentCard,
  Message,
  Task,
  Artifact,
  TextPart,
  Part,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
} from "@a2a-js/sdk"

export type StreamEvent =
  | { type: "task"; task: Task }
  | { type: "message"; contextId: string; text: string }
  | { type: "statusUpdate"; taskId: string; contextId: string; state: string; message?: string; final?: boolean }
  | { type: "artifact"; taskId: string; contextId: string; artifact: Artifact }
  | { type: "error"; code: number; message: string }

let clientFactory: ClientFactory | null = null
const clientCache = new Map<string, Client>()

function getClientFactory(): ClientFactory {
  if (!clientFactory) {
    clientFactory = new ClientFactory(ClientFactoryOptions.default)
  }
  return clientFactory
}

async function getClient(agentCard: AgentCard): Promise<Client> {
  const cacheKey = agentCard.url
  let client = clientCache.get(cacheKey)
  if (!client) {
    client = await getClientFactory().createFromAgentCard(agentCard)
    clientCache.set(cacheKey, client)
  }
  return client
}

export function setClientFactory(factory: ClientFactory | null) {
  clientFactory = factory
}

export interface SendMessageParams {
  agentCard: AgentCard
  message: Message
  contextId?: string
  signal?: AbortSignal
}

export interface StreamMessageResult {
  contextId: string
  task: Task | null
  text: string
  artifacts: Artifact[]
}

function isTextPart(p: Part): p is TextPart {
  return p.kind === "text"
}

function isTask(obj: unknown): obj is Task {
  return typeof obj === "object" && obj !== null && "kind" in obj && obj.kind === "task"
}

function isMessage(obj: unknown): obj is Message {
  return typeof obj === "object" && obj !== null && "kind" in obj && obj.kind === "message"
}

function isStatusUpdate(obj: unknown): obj is TaskStatusUpdateEvent {
  return typeof obj === "object" && obj !== null && "kind" in obj && obj.kind === "status-update"
}

function isArtifactUpdate(obj: unknown): obj is TaskArtifactUpdateEvent {
  return typeof obj === "object" && obj !== null && "kind" in obj && obj.kind === "artifact-update"
}

export async function sendMessage(params: SendMessageParams): Promise<StreamMessageResult> {
  const { agentCard, message, contextId, signal } = params

  const client = await getClient(agentCard)
  const options: RequestOptions = signal ? { signal } : {}

  const result = await client.sendMessage(
    {
      message: {
        ...message,
        contextId: contextId ?? message.contextId,
      },
    },
    options,
  )

  const task = isTask(result) ? result : undefined
  const text =
    task?.artifacts
      ?.filter((a) => a.name === "response")
      .flatMap((a) => a.parts.filter(isTextPart).map((p) => p.text))
      .join("") ?? ""

  return {
    contextId: task?.contextId ?? contextId ?? "",
    task: task ?? null,
    text,
    artifacts: task?.artifacts ?? [],
  }
}

export interface StreamMessageParams {
  agentCard: AgentCard
  message: Message
  contextId?: string
  signal?: AbortSignal
  onEvent?: (event: StreamEvent) => void
}

export async function* streamMessage(params: StreamMessageParams): AsyncGenerator<StreamEvent> {
  const { agentCard, message, contextId, signal, onEvent } = params

  const client = await getClient(agentCard)
  const options: RequestOptions = signal ? { signal } : {}

  const stream = client.sendMessageStream(
    {
      message: {
        ...message,
        contextId: contextId ?? message.contextId,
      },
    },
    options,
  )

  for await (const data of stream) {
    const event = transformStreamEvent(data)
    if (event) {
      onEvent?.(event)
      yield event
    }
  }
}

export function transformStreamEvent(
  data: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
): StreamEvent | null {
  if (isTask(data)) {
    return { type: "task", task: data }
  }

  if (isMessage(data)) {
    const text = data.parts
      .filter(isTextPart)
      .map((p) => p.text)
      .join("")
    return { type: "message", contextId: data.contextId ?? "", text }
  }

  if (isStatusUpdate(data)) {
    const statusMessage = data.status.message?.parts
      ?.filter(isTextPart)
      .map((p) => p.text)
      .join("")
    return {
      type: "statusUpdate",
      taskId: data.taskId,
      contextId: data.contextId,
      state: data.status.state,
      message: statusMessage,
      final: data.final,
    }
  }

  if (isArtifactUpdate(data)) {
    return {
      type: "artifact",
      taskId: data.taskId,
      contextId: data.contextId,
      artifact: data.artifact,
    }
  }

  return null
}

export async function getTask(agentCard: AgentCard, taskId: string, signal?: AbortSignal): Promise<Task> {
  const client = await getClient(agentCard)
  const options: RequestOptions = signal ? { signal } : {}

  return client.getTask({ id: taskId }, options)
}

export async function cancelTask(agentCard: AgentCard, taskId: string, signal?: AbortSignal): Promise<Task> {
  const client = await getClient(agentCard)
  const options: RequestOptions = signal ? { signal } : {}

  return client.cancelTask({ id: taskId }, options)
}

export function clearClientCache() {
  clientCache.clear()
}

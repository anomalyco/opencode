import type {
  FileDiffInfo,
  JsonValue,
  PromptFileAttachment,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageCompaction,
  SessionMessageInfo,
  SessionMessageUser,
} from "@opencode-ai/client/promise"
import type { SessionV1 } from "@opencode-ai/schema/session-v1"
import type { Share } from "./share"

type Entry<Type extends Share.Data["type"]> = Extract<Share.Data, { type: Type }>["data"]
type LegacySession = Exclude<Entry<"session">, SessionInfo>
type LegacyMessage = typeof SessionV1.Info.Type
type LegacyPart = typeof SessionV1.Part.Type

export async function readShareDocument(data: Share.Data[]) {
  const blob = parseShareBlob(data)
  if (blob.type === "current")
    return {
      session: blob.session,
      messages: blob.messages,
      diffs: currentDiffs(blob.diffs),
      models: blob.models,
      version: "2",
    }

  const migrated = await mapFromLegacySession(blob)
  return { ...migrated, diffs: currentDiffs(blob.diffs), models: blob.models }
}

async function mapFromLegacySession(blob: {
  session: LegacySession
  messages: Entry<"message">[]
  parts: Entry<"part">[]
}) {
  const [{ SessionV1 }, { Option, Schema }] = await Promise.all([
    import("@opencode-ai/schema/session-v1"),
    import("effect"),
  ])
  const session = Schema.decodeUnknownSync(SessionV1.SessionInfo)(legacySessionDefaults(blob.session))
  const decodeMessage = Schema.decodeUnknownOption(SessionV1.Info)
  const decodePart = Schema.decodeUnknownOption(SessionV1.Part)
  const messages = blob.messages.flatMap((message) =>
    Option.match(decodeMessage(legacyMessageDefaults(message)), { onNone: () => [], onSome: (value) => [value] }),
  )
  const parts = blob.parts.flatMap((part) =>
    Option.match(decodePart(part), { onNone: () => [], onSome: (value) => [value] }),
  )
  const ownMessages = messages.filter((message) => message.sessionID === session.id)
  return {
    session: currentSession(session, ownMessages),
    messages: currentMessages(
      ownMessages,
      parts.filter((part) => part.sessionID === session.id),
    ),
    version: session.version,
  }
}

function currentSession(session: typeof SessionV1.SessionInfo.Type, messages: LegacyMessage[]): SessionInfo {
  const latestUser = messages.findLast((message): message is typeof SessionV1.User.Type => message.role === "user")
  const model =
    session.model ??
    (latestUser
      ? {
          id: latestUser.model.modelID,
          providerID: latestUser.model.providerID,
          ...(latestUser.model.variant ? { variant: latestUser.model.variant } : {}),
        }
      : undefined)
  const agent = session.agent ?? latestUser?.agent
  return {
    id: session.id,
    projectID: session.projectID,
    ...(session.parentID ? { parentID: session.parentID } : {}),
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...(session.title === undefined ? {} : { title: session.title }),
    location: { directory: session.directory },
    ...(session.path ? { subpath: session.path } : {}),
    time: {
      created: session.time.created,
      updated: session.time.updated,
      ...(session.time.archived === undefined ? {} : { archived: session.time.archived }),
    },
  }
}

function currentMessages(messages: LegacyMessage[], parts: LegacyPart[]): SessionMessageInfo[] {
  const byMessage = Map.groupBy(parts, (part) => part.messageID)
  return messages
    .toSorted((a, b) => a.time.created - b.time.created || a.id.localeCompare(b.id))
    .flatMap((message): SessionMessageInfo[] => {
      const owned = byMessage.get(message.id) ?? []
      if (message.role === "user") {
        const compaction = owned.find((part) => part.type === "compaction")
        if (compaction?.type === "compaction")
          return [
            {
              id: message.id,
              type: "compaction",
              status: "completed",
              reason: compaction.auto ? "auto" : "manual",
              summary: "",
              recent: "",
              time: { created: message.time.created },
            } satisfies SessionMessageCompaction,
          ]
        return currentUser(message, owned)
      }
      return [currentAssistant(message, owned)]
    })
}

function currentUser(message: typeof SessionV1.User.Type, parts: LegacyPart[]): SessionMessageUser[] {
  const text = parts
    .flatMap((part) => {
      if (part.type === "text" && !part.synthetic) return [part.text]
      if (part.type === "file" && !part.url.startsWith("data:")) return [unavailableFile(part)]
      return []
    })
    .filter(Boolean)
    .join("\n\n")
  const files = parts.flatMap((part) => (part.type === "file" ? currentFile(part) : []))
  const agents = parts.flatMap((part) =>
    part.type === "agent"
      ? [
          {
            name: part.name,
            ...(part.source
              ? { mention: { text: part.source.value, start: part.source.start, end: part.source.end } }
              : {}),
          },
        ]
      : [],
  )
  if (!text && !files.length && !agents.length) return []
  return [
    {
      id: message.id,
      type: "user",
      text,
      ...(files.length ? { files } : {}),
      ...(agents.length ? { agents } : {}),
      metadata: {
        agent: message.agent,
        model: {
          id: message.model.modelID,
          providerID: message.model.providerID,
          ...(message.model.variant ? { variant: message.model.variant } : {}),
        },
      },
      time: { created: message.time.created },
    },
  ]
}

function currentAssistant(message: typeof SessionV1.Assistant.Type, parts: LegacyPart[]): SessionMessageAssistant {
  return {
    id: message.id,
    type: "assistant",
    agent: message.agent,
    model: {
      id: message.modelID,
      providerID: message.providerID,
      ...(message.variant ? { variant: message.variant } : {}),
    },
    content: parts.flatMap((part): SessionMessageAssistant["content"] => {
      if (part.type === "text") return [{ type: "text", text: part.text }]
      if (part.type === "reasoning")
        return [
          {
            type: "reasoning",
            text: part.text,
          },
        ]
      if (part.type === "tool") return [currentTool(part, message.time.created)]
      return []
    }),
    ...(message.error ? { error: currentError(message.error) } : {}),
    time: {
      created: message.time.created,
      ...(message.time.completed === undefined ? {} : { completed: message.time.completed }),
    },
  }
}

function currentTool(part: typeof SessionV1.ToolPart.Type, fallback: number): SessionMessageAssistantTool {
  const base = {
    type: "tool" as const,
    id: part.callID,
    name: part.tool,
  }
  if (part.state.status === "pending")
    return { ...base, state: { status: "streaming", input: part.state.raw }, time: { created: fallback } }
  if (part.state.status === "running")
    return {
      ...base,
      state: {
        status: "running",
        input: jsonRecord(part.state.input) ?? {},
        metadata: jsonRecord(part.state.metadata) ?? {},
      },
      time: { created: part.state.time.start },
    }
  if (part.state.status === "completed") {
    return {
      ...base,
      state: {
        status: "completed",
        input: jsonRecord(part.state.input) ?? {},
        content: [
          {
            type: "text",
            text: part.state.time.compacted === undefined ? part.state.output : "[Old tool result content cleared]",
          },
        ],
        ...metadata(part.state.metadata),
      },
      time: { created: part.state.time.start },
    }
  }
  const output = part.state.metadata?.output
  return {
    ...base,
    state: {
      status: "error",
      input: jsonRecord(part.state.input) ?? {},
      error: { type: "tool.execution", message: part.state.error },
      ...(typeof output === "string" ? { content: [{ type: "text" as const, text: output }] } : {}),
      ...metadata(part.state.metadata),
    },
    time: { created: part.state.time.start },
  }
}

function currentFile(part: typeof SessionV1.FilePart.Type): PromptFileAttachment[] {
  if (!part.url.startsWith("data:")) return []
  const comma = part.url.indexOf(",")
  if (comma < 0) return []
  const header = part.url.slice(0, comma)
  const payload = part.url.slice(comma + 1)
  const decoded = header.endsWith(";base64") ? payload : decodeURIComponentSafe(payload)
  if (decoded === undefined) return []
  return [
    {
      data: header.endsWith(";base64") ? decoded : base64(decoded),
      mime: part.mime,
      source: part.source?.type === "resource" ? { type: "uri", uri: part.source.uri } : { type: "inline" },
      ...(part.filename ? { name: part.filename } : {}),
      ...(part.source
        ? { mention: { text: part.source.text.value, start: part.source.text.start, end: part.source.text.end } }
        : {}),
    },
  ]
}

function parseShareBlob(data: Share.Data[]) {
  let session: Entry<"session"> | undefined
  const batches: Share.Messages[] = []
  let diffs: Entry<"session_diff"> = []
  let models: Entry<"model"> = []
  const messages: Entry<"message">[] = []
  const parts: Entry<"part">[] = []
  data.forEach((item) => {
    if (item.type === "session") session = item.data
    if (item.type === "messages") batches.push(item.data)
    if (item.type === "message") messages.push(item.data)
    if (item.type === "part") parts.push(item.data)
    if (item.type === "session_diff") diffs = item.data
    if (item.type === "model") models = item.data
  })
  if (!session) throw new Error("Share blob is missing its Session")
  const sessionID = session.id
  if ("location" in session) {
    const current = batches.findLast((batch) => batch.sessionID === sessionID)
    if (!current) throw new Error("Current share blob is missing its message batch")
    return { type: "current" as const, session, messages: current.messages, diffs, models }
  }
  if (batches.some((batch) => batch.sessionID === sessionID))
    throw new Error("Legacy share blob has an unexpected current message batch")
  return { type: "legacy" as const, session, messages, parts, diffs, models }
}

function currentDiffs(diffs: Entry<"session_diff">): FileDiffInfo[] {
  return diffs.map((diff) => ({
    file: diff.file,
    patch: diff.patch,
    additions: diff.additions,
    deletions: diff.deletions,
    status:
      diff.status ??
      (diff.additions > 0 && diff.deletions === 0
        ? "added"
        : diff.deletions > 0 && diff.additions === 0
          ? "deleted"
          : "modified"),
  }))
}

function legacySessionDefaults(input: unknown) {
  if (!record(input)) return input
  return { ...input, slug: typeof input.slug === "string" ? input.slug : String(input.id ?? "legacy") }
}

function legacyMessageDefaults(input: unknown) {
  if (!record(input) || input.role !== "assistant" || typeof input.agent === "string") return input
  return { ...input, agent: typeof input.mode === "string" ? input.mode : "build" }
}

function metadata(input: unknown) {
  const value = jsonRecord(input)
  return value ? { metadata: value } : {}
}

function jsonRecord(input: unknown): Record<string, JsonValue> | undefined {
  if (!record(input)) return undefined
  const output = Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, JsonValue] => isJson(entry[1])),
  )
  return Object.keys(output).length ? output : undefined
}

function isJson(input: unknown): input is JsonValue {
  if (input === null || typeof input === "string" || typeof input === "boolean") return true
  if (typeof input === "number") return Number.isFinite(input)
  if (Array.isArray(input)) return input.every(isJson)
  return record(input) && Object.values(input).every(isJson)
}

function record(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input)
}

function base64(input: string) {
  return btoa(Array.from(new TextEncoder().encode(input), (byte) => String.fromCharCode(byte)).join(""))
}

function decodeURIComponentSafe(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return undefined
  }
}

function unavailableFile(part: typeof SessionV1.FilePart.Type) {
  const label = part.filename ?? (part.source?.type === "resource" ? part.source.uri : part.url)
  return `[Attachment unavailable after migration: ${label} (${part.mime})]`
}

function currentError(error: NonNullable<(typeof SessionV1.Assistant.Type)["error"]>) {
  const message = "message" in error.data ? error.data.message : error.name
  return { type: error.name === "MessageAbortedError" ? "aborted" : "unknown", message }
}

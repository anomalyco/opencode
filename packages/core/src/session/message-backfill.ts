export * as SessionMessageBackfill from "./message-backfill"

import { createHash } from "crypto"
import { DateTime } from "effect"
import { ModelV2 } from "../model"
import { ToolOutput } from "../tool-output"
import { SessionEvent } from "./event"
import { SessionLegacy } from "./legacy"
import { SessionMessage } from "./message"
import { AgentAttachment, FileAttachment, Source } from "./prompt"
import { SessionSchema } from "./schema"

const migrationVersion = "legacy-session-message-backfill/v1/mapper-subset"
const backfillMessagePrefix = "evt_legacy_backfill_m_"
const backfillContentPrefix = "evt_legacy_backfill_c_"
const ordinalWidth = 8
const maxOrdinal = 36 ** ordinalWidth - 1

export type Stat = {
  type: string
  reason: string
  count: number
}

export type Stats = {
  mapped: Stat[]
  degraded: Stat[]
  skipped: Stat[]
}

export type Result = {
  messages: SessionMessage.Message[]
  stats: Stats
}

export function mapLegacyMessages(
  input: readonly SessionLegacy.WithParts[],
  options: { sessionID: SessionSchema.ID | string },
): Result {
  const stats = makeStats()
  const entries = input
    .slice()
    .sort((left, right) => left.info.time.created - right.info.time.created || compareID(left.info.id, right.info.id))
  const compactions = compactionPairs(entries, stats)
  const folded = new Set([...compactions.keys(), ...Array.from(compactions.values(), (pair) => pair.summaryOrdinal)])
  const compactionMarkers = new Set(
    entries.flatMap((entry, messageOrdinal) => (entry.info.role === "user" && compactionPart(entry) ? [messageOrdinal] : [])),
  )
  const emittedIDs = new Map(
    entries.flatMap((entry, messageOrdinal): [string, SessionMessage.ID][] => {
      if (folded.has(messageOrdinal) || compactionMarkers.has(messageOrdinal)) return []
      return [[entry.info.id, messageID(options.sessionID, entry.info.id, messageOrdinal)]]
    }),
  )
  const messages: SessionMessage.Message[] = entries.flatMap((entry, messageOrdinal): SessionMessage.Message[] => {
    const compaction = compactions.get(messageOrdinal)
    if (compaction) {
      if (!compaction.summary) return []
      return [mapCompaction({ ...compaction, summary: compaction.summary }, options.sessionID, messageOrdinal, emittedIDs, stats)]
    }
    if (folded.has(messageOrdinal)) return []
    if (compactionMarkers.has(messageOrdinal)) {
      addStat(stats.skipped, "compaction", "compaction_marker_incomplete")
      return []
    }
    if (entry.info.role === "user") return [mapUser(entry, options.sessionID, messageOrdinal, stats)]
    return [mapAssistant({ info: entry.info, parts: entry.parts }, options.sessionID, messageOrdinal, stats)]
  })

  return { messages, stats }
}

type CompactionPair = {
  marker: SessionLegacy.WithParts & { info: SessionLegacy.User }
  summaryOrdinal: number
  part: SessionLegacy.CompactionPart
  summary: string | undefined
}

function compactionPairs(entries: readonly SessionLegacy.WithParts[], stats: Stats) {
  const markers = new Map(
    entries.flatMap((entry, ordinal): [string, { entry: SessionLegacy.WithParts & { info: SessionLegacy.User }; ordinal: number; part: SessionLegacy.CompactionPart }][] => {
      if (entry.info.role !== "user") return []
      const part = compactionPart(entry)
      if (!part) return []
      return [[entry.info.id, { entry: entry as SessionLegacy.WithParts & { info: SessionLegacy.User }, ordinal, part }]]
    }),
  )

  return new Map(
    entries.flatMap((entry, summaryOrdinal): [number, CompactionPair][] => {
      if (entry.info.role !== "assistant") return []
      if (entry.info.summary !== true || entry.info.error !== undefined || !entry.info.finish) return []
      const marker = markers.get(entry.info.parentID)
      if (!marker) return []
      const summary = summaryText(entry)
      if (!summary) addStat(stats.degraded, "compaction", "compaction_summary_empty")
      return [
        [
          marker.ordinal,
          {
            marker: marker.entry,
            summaryOrdinal,
            part: marker.part,
            summary,
          },
        ],
      ]
    }),
  )
}

function mapCompaction(
  pair: CompactionPair & { summary: string },
  sessionID: SessionSchema.ID | string,
  messageOrdinal: number,
  emittedIDs: Map<string, SessionMessage.ID>,
  stats: Stats,
) {
  const include = pair.part.tail_start_id ? emittedIDs.get(pair.part.tail_start_id) : undefined
  if (pair.part.tail_start_id && include === undefined) addStat(stats.degraded, "compaction", "compaction_include_missing")
  addStat(stats.mapped, "compaction", "compaction_message")
  return new SessionMessage.Compaction({
    id: messageID(sessionID, pair.marker.info.id, messageOrdinal),
    type: "compaction",
    reason: pair.part.auto ? "auto" : "manual",
    summary: pair.summary,
    include,
    time: { created: DateTime.makeUnsafe(pair.marker.info.time.created) },
  })
}

function compactionPart(entry: SessionLegacy.WithParts) {
  return sortedParts(entry.parts).find((part): part is SessionLegacy.CompactionPart => part.type === "compaction")
}

function summaryText(message: SessionLegacy.WithParts) {
  const text = sortedParts(message.parts)
    .filter((part): part is SessionLegacy.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
  return text || undefined
}

function mapUser(
  entry: SessionLegacy.WithParts,
  sessionID: SessionSchema.ID | string,
  messageOrdinal: number,
  stats: Stats,
) {
  const parts = sortedParts(entry.parts)
  const text = parts
    .filter((part): part is SessionLegacy.TextPart => part.type === "text" && !part.ignored && !part.synthetic)
    .map((part) => part.text)
    .join("\n")
  const files = parts
    .filter((part): part is SessionLegacy.FilePart => part.type === "file")
    .map((part) => {
      if (part.source) addStat(stats.degraded, part.type, "file_source_kind_unsupported")
      addStat(stats.mapped, part.type, "user_file")
      return new FileAttachment({
        uri: part.url,
        mime: part.mime,
        name: part.filename,
        source: part.source
          ? new Source({ text: part.source.text.value, start: part.source.text.start, end: part.source.text.end })
          : undefined,
      })
    })
  const agents = parts
    .filter((part): part is SessionLegacy.AgentPart => part.type === "agent")
    .map((part) => {
      addStat(stats.mapped, part.type, "user_agent")
      return new AgentAttachment({
        name: part.name,
        source: part.source ? new Source({ text: part.source.value, start: part.source.start, end: part.source.end }) : undefined,
      })
    })

  parts
    .filter((part): part is SessionLegacy.TextPart => part.type === "text" && !!(part.ignored || part.synthetic))
    .forEach((part) => addStat(stats.degraded, part.type, part.synthetic ? "synthetic_embedded_unsupported" : "ignored_text_omitted"))
  parts
    .filter((part) => part.type !== "text" && part.type !== "file" && part.type !== "agent")
    .forEach((part) => addUnsupportedPartStat(part, stats, "user"))

  addStat(stats.mapped, entry.info.role, "user_message")
  return new SessionMessage.User({
    id: messageID(sessionID, entry.info.id, messageOrdinal),
    type: "user",
    text,
    files,
    agents,
    references: [],
    time: { created: DateTime.makeUnsafe(entry.info.time.created) },
  })
}

function mapAssistant(
  entry: { info: SessionLegacy.Assistant; parts: SessionLegacy.Part[] },
  sessionID: SessionSchema.ID | string,
  messageOrdinal: number,
  stats: Stats,
) {
  const parts = sortedParts(entry.parts)
  const mappedContentParts = parts.filter(
    (part): part is SessionLegacy.TextPart | SessionLegacy.ReasoningPart | SessionLegacy.ToolPart =>
      part.type === "text" || part.type === "reasoning" || part.type === "tool",
  )
  const content: SessionMessage.AssistantContent[] = mappedContentParts.flatMap((part, contentOrdinal): SessionMessage.AssistantContent[] => {
    if (part.type === "text") {
      if (part.ignored || part.synthetic) {
        addStat(stats.degraded, part.type, part.synthetic ? "synthetic_embedded_unsupported" : "ignored_text_omitted")
        return []
      }
      addStat(stats.mapped, part.type, "assistant_text")
      return [
        new SessionMessage.AssistantText({
          type: "text",
          id: contentID(sessionID, entry.info.id, part.id, "assistant_text", messageOrdinal, contentOrdinal),
          text: part.text,
        }),
      ]
    }
    if (part.type === "tool") return [mapToolPart(part, entry, sessionID, messageOrdinal, contentOrdinal, stats)]
    addStat(stats.mapped, part.type, "assistant_reasoning")
    return [
      new SessionMessage.AssistantReasoning({
        type: "reasoning",
        id: contentID(sessionID, entry.info.id, part.id, "assistant_reasoning", messageOrdinal, contentOrdinal),
        reasoningID: reasoningID(sessionID, entry.info.id, part.id, messageOrdinal, contentOrdinal),
        text: part.text,
      }),
    ]
  })
  const stepFinish = parts.filter((part): part is SessionLegacy.StepFinishPart => part.type === "step-finish").at(-1)
  const stepStart = parts.find((part): part is SessionLegacy.StepStartPart => part.type === "step-start" && part.snapshot !== undefined)
  const retries = parts
    .filter((part): part is SessionLegacy.RetryPart => part.type === "retry")
    .flatMap((part): SessionMessage.AssistantRetry[] => {
      if (part.messageID !== entry.info.id) {
        addStat(stats.skipped, part.type, "retry_no_active_assistant")
        return []
      }
      addStat(stats.mapped, part.type, "assistant_retry")
      return [
        new SessionMessage.AssistantRetry({
          attempt: part.attempt,
          error: mapRetryError(part, stats),
          time: { created: DateTime.makeUnsafe(part.time.created) },
        }),
      ]
    })

  parts
    .filter((part) => part.type !== "text" && part.type !== "reasoning" && part.type !== "tool" && part.type !== "retry" && part.type !== "step-start" && part.type !== "step-finish")
    .forEach((part) => addUnsupportedPartStat(part, stats, "assistant"))
  if (entry.info.structured !== undefined) addStat(stats.degraded, "assistant", "assistant_structured_schema_missing")
  addStat(stats.degraded, "assistant", "assistant_mode_schema_missing")
  addStat(stats.degraded, "assistant", "assistant_path_schema_missing")
  if (entry.info.tokens.total !== undefined) addStat(stats.degraded, "assistant", "assistant_tokens_total_not_representable")

  if (stepFinish) {
    if (entry.info.finish && entry.info.finish !== stepFinish.reason) addStat(stats.degraded, "step-finish", "assistant_finish_conflict")
    if (entry.info.cost !== undefined && entry.info.cost !== stepFinish.cost) addStat(stats.degraded, "step-finish", "assistant_cost_conflict")
    if (!representableTokensMatch(entry.info.tokens, stepFinish.tokens)) {
      addStat(stats.degraded, "step-finish", "assistant_tokens_conflict")
    }
  }

  const finish = entry.info.finish || stepFinish?.reason
  const cost = entry.info.cost ?? stepFinish?.cost
  const snapshotEnd = stepFinish?.snapshot
  const tokens = {
    input: entry.info.tokens.input,
    output: entry.info.tokens.output,
    reasoning: entry.info.tokens.reasoning,
    cache: { read: entry.info.tokens.cache.read, write: entry.info.tokens.cache.write },
  }

  addStat(stats.mapped, entry.info.role, "assistant_message")
  return new SessionMessage.Assistant({
    id: messageID(sessionID, entry.info.id, messageOrdinal),
    type: "assistant",
    agent: entry.info.agent,
    model: {
      providerID: entry.info.providerID,
      id: ModelV2.ID.make(entry.info.modelID),
      variant: entry.info.variant ? ModelV2.VariantID.make(entry.info.variant) : undefined,
    },
    content,
    snapshot: stepStart?.snapshot || snapshotEnd ? { start: stepStart?.snapshot, end: snapshotEnd } : undefined,
    finish,
    cost,
    retries: retries.length > 0 ? retries : undefined,
    tokens,
    error: entry.info.error ? mapAssistantError(entry.info.error, stats) : undefined,
    time: {
      created: DateTime.makeUnsafe(entry.info.time.created),
      completed: entry.info.time.completed ? DateTime.makeUnsafe(entry.info.time.completed) : undefined,
    },
  })
}

function mapToolPart(
  part: SessionLegacy.ToolPart,
  entry: { info: SessionLegacy.Assistant },
  sessionID: SessionSchema.ID | string,
  messageOrdinal: number,
  contentOrdinal: number,
  stats: Stats,
) {
  const state = mapToolState(part, stats)
  addStat(stats.mapped, part.type, `assistant_tool_${part.state.status}`)
  return new SessionMessage.AssistantTool({
    type: "tool",
    id: contentID(sessionID, entry.info.id, part.id, "assistant_tool", messageOrdinal, contentOrdinal),
    callID: part.callID,
    name: part.tool,
    provider: mapToolProvider(part, stats),
    state,
    time: mapToolTime(part, entry.info.time.created),
  })
}

function mapToolState(part: SessionLegacy.ToolPart, stats: Stats): SessionMessage.ToolState {
  if (part.state.status === "pending") {
    if (part.state.raw === "" && Object.keys(part.state.input).length > 0) {
      addStat(stats.degraded, part.type, "tool_pending_raw_empty_with_structured_input")
    }
    return new SessionMessage.ToolStatePending({ status: "pending", input: part.state.raw })
  }
  if (part.state.status === "running") {
    degradeToolStateMetadata(part, stats)
    if (part.state.title !== undefined) addStat(stats.degraded, part.type, "tool_title_schema_missing")
    return new SessionMessage.ToolStateRunning({
      status: "running",
      input: part.state.input,
      structured: mapToolStructured(part, stats),
      content: [],
    })
  }
  if (part.state.status === "completed") {
    degradeToolStateMetadata(part, stats)
    addStat(stats.degraded, part.type, "tool_title_schema_missing")
    return new SessionMessage.ToolStateCompleted({
      status: "completed",
      input: part.state.input,
      structured: mapToolStructured(part, stats),
      content: [new ToolOutput.TextContent({ type: "text", text: part.state.output }), ...mapToolAttachments(part, stats)],
    })
  }
  degradeToolStateMetadata(part, stats)
  return new SessionMessage.ToolStateError({
    status: "error",
    input: part.state.input,
    structured: mapToolStructured(part, stats),
    content: mapToolErrorContent(part, stats),
    error: { type: "unknown", message: part.state.error },
  })
}

function mapToolTime(part: SessionLegacy.ToolPart, created: number) {
  if (part.state.status === "pending") return { created: DateTime.makeUnsafe(created) }
  if (part.state.status === "running") return { created: DateTime.makeUnsafe(created), ran: DateTime.makeUnsafe(part.state.time.start) }
  if (part.state.status === "completed") {
    return {
      created: DateTime.makeUnsafe(created),
      ran: DateTime.makeUnsafe(part.state.time.start),
      completed: DateTime.makeUnsafe(part.state.time.end),
      pruned: part.state.time.compacted ? DateTime.makeUnsafe(part.state.time.compacted) : undefined,
    }
  }
  return {
    created: DateTime.makeUnsafe(created),
    ran: DateTime.makeUnsafe(part.state.time.start),
    completed: DateTime.makeUnsafe(part.state.time.end),
  }
}

function mapToolProvider(part: SessionLegacy.ToolPart, stats: Stats) {
  if (!part.metadata) return undefined
  const metadata = Object.fromEntries(Object.entries(part.metadata).filter(([key]) => key !== "providerExecuted"))
  if ("providerExecuted" in part.metadata && typeof part.metadata.providerExecuted !== "boolean") {
    addStat(stats.degraded, part.type, "tool_provider_executed_invalid")
  }
  return {
    executed: part.metadata.providerExecuted === true,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  }
}

function mapToolAttachments(part: SessionLegacy.ToolPart, stats: Stats) {
  if (part.state.status !== "completed") return []
  return (part.state.attachments ?? []).map((attachment) => {
    if (attachment.source) addStat(stats.degraded, "file", "file_source_kind_unsupported")
    addStat(stats.mapped, "file", "tool_file_content")
    return new ToolOutput.FileContent({ type: "file", uri: attachment.url, mime: attachment.mime, name: attachment.filename })
  })
}

function mapToolStructured(part: SessionLegacy.ToolPart, stats: Stats) {
  if (part.state.status === "pending") return {}
  if (isRecord(part.state.metadata?.structured)) {
    addStat(stats.mapped, part.type, "tool_structured_metadata")
    return part.state.metadata.structured
  }
  return {}
}

function mapToolErrorContent(part: SessionLegacy.ToolPart, stats: Stats) {
  if (part.state.status !== "error") return []
  if (typeof part.state.metadata?.output === "string") {
    addStat(stats.mapped, part.type, "tool_error_output_text")
    return [new ToolOutput.TextContent({ type: "text", text: part.state.metadata.output })]
  }
  if (part.state.metadata && "output" in part.state.metadata) addStat(stats.degraded, part.type, "tool_error_output_not_representable")
  return []
}

function degradeToolStateMetadata(part: SessionLegacy.ToolPart, stats: Stats) {
  if (part.state.status === "pending" || !part.state.metadata) return
  const unsupportedKeys = Object.keys(part.state.metadata).filter((key) => key !== "structured" && !(part.state.status === "error" && key === "output"))
  if (unsupportedKeys.length > 0) addStat(stats.degraded, part.type, "tool_state_metadata_schema_missing")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function mapAssistantError(error: NonNullable<SessionLegacy.Assistant["error"]>, stats: Stats): SessionEvent.AssistantError {
  if (error.name === "ProviderAuthError") {
    addStat(stats.mapped, "assistant_error", "auth")
    return { type: "auth", providerID: error.data.providerID, message: error.data.message }
  }
  if (error.name === "APIError") {
    addStat(stats.mapped, "assistant_error", "api")
    return {
      type: "api",
      message: error.data.message,
      statusCode: error.data.statusCode,
      isRetryable: error.data.isRetryable,
      responseHeaders: error.data.responseHeaders,
      responseBody: error.data.responseBody,
      metadata: error.data.metadata,
    }
  }
  if (error.name === "MessageAbortedError") {
    addStat(stats.mapped, "assistant_error", "aborted")
    return { type: "aborted", message: error.data.message }
  }
  if (error.name === "MessageOutputLengthError") {
    addStat(stats.mapped, "assistant_error", "output_length")
    return { type: "output_length" }
  }
  if (error.name === "StructuredOutputError") {
    addStat(stats.mapped, "assistant_error", "structured_output")
    return { type: "structured_output", message: error.data.message, retries: error.data.retries }
  }
  if (error.name === "ContextOverflowError") {
    addStat(stats.mapped, "assistant_error", "context_overflow")
    return { type: "context_overflow", message: error.data.message, responseBody: error.data.responseBody }
  }
  if (error.name === "UnknownError") {
    addStat(stats.mapped, "assistant_error", "unknown")
    return { type: "unknown", message: error.data.message }
  }
  addStat(stats.degraded, "assistant_error", "assistant_error_unknown_category")
  return { type: "unknown", message: "Unknown assistant error" }
}

function mapRetryError(part: SessionLegacy.RetryPart, stats: Stats): SessionEvent.RetryError {
  if (isRecord(part.error) && part.error.name === "APIError" && isRecord(part.error.data)) {
    if (typeof part.error.data.message === "string" && typeof part.error.data.isRetryable === "boolean") {
      return {
        message: part.error.data.message,
        statusCode: typeof part.error.data.statusCode === "number" ? part.error.data.statusCode : undefined,
        isRetryable: part.error.data.isRetryable,
        responseHeaders: stringRecord(part.error.data.responseHeaders),
        responseBody: typeof part.error.data.responseBody === "string" ? part.error.data.responseBody : undefined,
        metadata: stringRecord(part.error.data.metadata),
      }
    }
    addStat(stats.degraded, part.type, "retry_error_malformed")
    return {
      message: typeof part.error.data.message === "string" ? part.error.data.message : "Malformed retry error",
      statusCode: typeof part.error.data.statusCode === "number" ? part.error.data.statusCode : undefined,
      isRetryable: false,
      responseHeaders: stringRecord(part.error.data.responseHeaders),
      responseBody: typeof part.error.data.responseBody === "string" ? part.error.data.responseBody : undefined,
      metadata: stringRecord(part.error.data.metadata),
    }
  }
  addStat(stats.degraded, part.type, "retry_error_category_unsupported")
  return {
    message: isRecord(part.error) && isRecord(part.error.data) && typeof part.error.data.message === "string" ? part.error.data.message : "Unsupported retry error",
    isRetryable: false,
  }
}

function stringRecord(value: unknown) {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function addUnsupportedPartStat(part: SessionLegacy.Part, stats: Stats, location: "assistant" | "user") {
  if (part.type === "subtask") return addStat(stats.skipped, part.type, "subtask_schema_missing")
  if (part.type === "patch") return addStat(stats.skipped, part.type, "patch_schema_missing")
  if (part.type === "tool") return addStat(stats.skipped, part.type, "tool_mapping_excluded")
  if (part.type === "retry") return addStat(stats.skipped, part.type, location === "user" ? "retry_user_unsupported" : "retry_no_active_assistant")
  if (part.type === "compaction") return addStat(stats.skipped, part.type, "compaction_mapping_excluded")
  if (part.type === "snapshot") return addStat(stats.skipped, part.type, "standalone_snapshot_unsupported")
  if (part.type === "file") return addStat(stats.skipped, part.type, "assistant_file_location_schema_missing")
  if (part.type === "agent") return addStat(stats.degraded, part.type, "assistant_agent_metadata_schema_missing")
  return addStat(stats.skipped, part.type, "part_mapping_unsupported")
}

function representableTokensMatch(
  left: SessionLegacy.Assistant["tokens"],
  right: SessionLegacy.StepFinishPart["tokens"],
) {
  return (
    left.input === right.input &&
    left.output === right.output &&
    left.reasoning === right.reasoning &&
    left.cache.read === right.cache.read &&
    left.cache.write === right.cache.write
  )
}

function sortedParts(parts: readonly SessionLegacy.Part[]) {
  return parts.slice().sort((left, right) => compareID(left.id, right.id))
}

function compareID(left: string, right: string) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function messageID(sessionID: SessionSchema.ID | string, legacyMessageID: string, messageOrdinal: number) {
  return SessionMessage.ID.make(
    `${backfillMessagePrefix}${formatOrdinal(messageOrdinal)}_${hash([
      migrationVersion,
      sessionID,
      legacyMessageID,
      "message",
      messageOrdinal,
    ])}`,
  )
}

function contentID(
  sessionID: SessionSchema.ID | string,
  legacyMessageID: string,
  legacyPartID: string,
  targetKind: string,
  messageOrdinal: number,
  contentOrdinal: number,
) {
  return SessionMessage.ID.make(
    `${backfillContentPrefix}${formatOrdinal(messageOrdinal)}_${formatOrdinal(contentOrdinal)}_${hash([
      migrationVersion,
      sessionID,
      legacyMessageID,
      legacyPartID,
      targetKind,
      messageOrdinal,
      contentOrdinal,
    ])}`,
  )
}

function reasoningID(
  sessionID: SessionSchema.ID | string,
  legacyMessageID: string,
  legacyPartID: string,
  messageOrdinal: number,
  contentOrdinal: number,
) {
  return `rsn_legacy_backfill_${formatOrdinal(messageOrdinal)}_${formatOrdinal(contentOrdinal)}_${hash([
    migrationVersion,
    sessionID,
    legacyMessageID,
    legacyPartID,
    "assistant_reasoning_reasoning_id",
    messageOrdinal,
    contentOrdinal,
  ])}`
}

function formatOrdinal(ordinal: number) {
  if (ordinal > maxOrdinal) throw new Error("legacy backfill ordinal exceeds fixed-width base36 range")
  return ordinal.toString(36).padStart(ordinalWidth, "0")
}

function hash(values: readonly (string | number)[]) {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 24)
}

function makeStats(): Stats {
  return { mapped: [], degraded: [], skipped: [] }
}

function addStat(stats: Stat[], type: string, reason: string) {
  const existing = stats.find((stat) => stat.type === type && stat.reason === reason)
  if (existing) {
    existing.count++
    return
  }
  stats.push({ type, reason, count: 1 })
}

/** Reserved flat metadata key carried by a complete branch-closure TextPart. */
export const CLOSURE_RECORD_METADATA_KEY = "opencode.branch_closure" as const

/**
 * The minimal transcript shape needed to classify a complete closure evidence pair.
 *
 * This is deliberately structural: both the domain `SessionV1.WithParts` shape and
 * SDK `{ info, parts }` responses satisfy it without importing either representation.
 */
export type ClosureRecordCandidate = {
  readonly info: {
    readonly role: string
    readonly id: string
    readonly sessionID: string
  }
  readonly parts: readonly {
    readonly type: string
    readonly synthetic?: boolean
    readonly sessionID: string
    readonly messageID: string
    readonly text?: string
    readonly metadata?: unknown
  }[]
}

type Metadata = Record<string, unknown>
type Terminal = "cancelled" | "completed" | "error" | "unknown"

const own = (value: Metadata, key: string) => Object.hasOwn(value, key)
const object = (value: unknown): value is Metadata =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0
const exactKeys = (value: Metadata, required: readonly string[], optional: readonly string[] = []) => {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => own(value, key)) && Object.keys(value).every((key) => allowed.has(key))
}
const terminal = (value: unknown): value is Terminal =>
  value === "cancelled" || value === "completed" || value === "error" || value === "unknown"

const closureSentence = (outcome: Terminal, yielded: boolean) => {
  const state = yielded ? "The Task had yielded with attached work outstanding at the fence. " : ""
  if (outcome === "cancelled") return `${state}Cancellation won physical closure.`
  if (outcome === "completed") return `${state}The tracked execution completed before cancellation took effect.`
  if (outcome === "error") return `${state}The tracked execution ended with an error before cancellation took effect.`
  return `${state}The terminal outcome could not be established.`
}

/**
 * Classifies the canonical complete Message/TextPart closure-evidence pair.
 *
 * This gate is intentionally strict because only a complete pair receives closure-record
 * semantics. A partial or malformed lookalike remains ordinary synthetic transcript data.
 */
export function isCompleteClosurePair(message: ClosureRecordCandidate): boolean {
  if (message.info.role !== "user" || message.parts.length !== 1) return false
  const part = message.parts[0]
  if (
    !part ||
    part.type !== "text" ||
    part.synthetic !== true ||
    part.sessionID !== message.info.sessionID ||
    part.messageID !== message.info.id
  )
    return false
  if (!object(part.metadata) || !exactKeys(part.metadata, [CLOSURE_RECORD_METADATA_KEY])) return false
  const data = part.metadata[CLOSURE_RECORD_METADATA_KEY]
  if (!object(data)) return false

  const source = data.identity_source
  if (source !== "prior_user_message" && source !== "session_identity" && source !== "resume_admission") return false
  const sourceKeys = source === "prior_user_message" ? ["source_user_message_id"] : []
  const common = [
    "version",
    "freeze_owner_operation_id",
    "generation",
    "fact_key",
    "identity_source",
    ...sourceKeys,
    "record_kind",
    "subject_session_id",
  ]
  if (
    data.version !== 1 ||
    !nonempty(data.freeze_owner_operation_id) ||
    typeof data.generation !== "number" ||
    !Number.isInteger(data.generation) ||
    data.generation <= 0 ||
    !nonempty(data.fact_key) ||
    !nonempty(data.subject_session_id) ||
    (source === "prior_user_message" && !nonempty(data.source_user_message_id))
  )
    return false

  const yielded = own(data, "state_at_fence")
  if (yielded && data.state_at_fence !== "yielded_with_outstanding_work") return false
  if (data.record_kind === "self") {
    if (!exactKeys(data, [...common, "terminal_outcome"], ["state_at_fence"])) return false
    if (data.subject_session_id !== message.info.sessionID || !terminal(data.terminal_outcome)) return false
    return (
      part.text ===
      `[Branch closure] This Session's prior Task execution: ${closureSentence(data.terminal_outcome, yielded)}`
    )
  }
  if (data.record_kind === "edge") {
    if (
      !exactKeys(
        data,
        [...common, "owner_session_id", "child_session_id", "terminal_outcome"],
        ["task_part_id", "state_at_fence"],
      )
    )
      return false
    if (
      data.owner_session_id !== message.info.sessionID ||
      data.subject_session_id !== data.child_session_id ||
      !nonempty(data.child_session_id) ||
      (own(data, "task_part_id") && !nonempty(data.task_part_id)) ||
      !terminal(data.terminal_outcome)
    )
      return false
    return (
      part.text ===
      `[Branch closure] Child Session ${data.child_session_id}: ${closureSentence(data.terminal_outcome, yielded)} Owner Session: ${data.owner_session_id}.`
    )
  }
  if (data.record_kind !== "root") return false
  if (
    !exactKeys(data, [...common, "requested_root_session_id", "branch_outcome"], ["terminal_outcome", "state_at_fence"])
  )
    return false
  if (
    data.requested_root_session_id !== message.info.sessionID ||
    data.subject_session_id !== data.requested_root_session_id ||
    data.branch_outcome !== "quiesced" ||
    (own(data, "terminal_outcome") && !terminal(data.terminal_outcome)) ||
    (yielded && !own(data, "terminal_outcome"))
  )
    return false
  if (!own(data, "terminal_outcome"))
    return (
      part.text ===
      `[Branch closure] Requested Session ${data.requested_root_session_id}: Its in-scope Task branch reached conversational quiescence.`
    )
  if (!terminal(data.terminal_outcome)) return false
  return (
    part.text ===
    `[Branch closure] Requested Session ${data.requested_root_session_id}: ${closureSentence(data.terminal_outcome, yielded)} Its in-scope Task branch reached conversational quiescence.`
  )
}

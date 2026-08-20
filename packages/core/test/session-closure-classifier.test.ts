import { describe, expect, test } from "bun:test"
import {
  CLOSURE_RECORD_METADATA_KEY,
  isCompleteClosurePair,
  type ClosureRecordCandidate,
} from "@opencode-ai/core/session/closure-record"

type Payload = Record<string, unknown>
type Candidate = {
  info: { role: string; id: string; sessionID: string }
  parts: Array<{
    type: string
    synthetic?: boolean
    sessionID: string
    messageID: string
    text?: string
    metadata?: unknown
  }>
}

const common = (kind: "self" | "edge" | "root", subject = "ses_owner"): Payload => ({
  version: 1,
  freeze_owner_operation_id: "operation-1",
  generation: 1,
  fact_key: `fact-${kind}`,
  identity_source: "prior_user_message",
  source_user_message_id: "msg_source",
  record_kind: kind,
  subject_session_id: subject,
})

const pair = (data: Payload, text: string, sessionID = "ses_owner"): Candidate => ({
  info: { role: "user", id: `msg_${String(data.record_kind)}`, sessionID },
  parts: [
    {
      type: "text",
      synthetic: true,
      sessionID,
      messageID: `msg_${String(data.record_kind)}`,
      text,
      metadata: { [CLOSURE_RECORD_METADATA_KEY]: data },
    },
  ],
})

const self = (): Candidate =>
  pair(
    { ...common("self"), terminal_outcome: "cancelled" },
    "[Branch closure] This Session's prior Task execution: Cancellation won physical closure.",
  )

const edge = (): Candidate =>
  pair(
    {
      ...common("edge", "ses_child"),
      owner_session_id: "ses_owner",
      child_session_id: "ses_child",
      task_part_id: "prt_task",
      terminal_outcome: "completed",
    },
    "[Branch closure] Child Session ses_child: The tracked execution completed before cancellation took effect. Owner Session: ses_owner.",
  )

const root = (): Candidate =>
  pair(
    {
      ...common("root"),
      requested_root_session_id: "ses_owner",
      branch_outcome: "quiesced",
    },
    "[Branch closure] Requested Session ses_owner: Its in-scope Task branch reached conversational quiescence.",
  )

const rootTerminal = (): Candidate =>
  pair(
    {
      ...common("root"),
      requested_root_session_id: "ses_owner",
      branch_outcome: "quiesced",
      terminal_outcome: "error",
      state_at_fence: "yielded_with_outstanding_work",
    },
    "[Branch closure] Requested Session ses_owner: The Task had yielded with attached work outstanding at the fence. The tracked execution ended with an error before cancellation took effect. Its in-scope Task branch reached conversational quiescence.",
  )

const payload = (candidate: Candidate): Payload => {
  const metadata = candidate.parts[0]?.metadata as Record<string, unknown>
  return metadata[CLOSURE_RECORD_METADATA_KEY] as Payload
}

type Rejection = {
  name: string
  make?: () => Candidate
  mutate: (candidate: Candidate) => void
}

const rejections: Rejection[] = [
  { name: "rejects a non-User Message", mutate: (item) => void (item.info.role = "assistant") },
  { name: "rejects two Parts", mutate: (item) => void item.parts.push(structuredClone(item.parts[0]!)) },
  { name: "rejects a non-Text Part", mutate: (item) => void (item.parts[0]!.type = "file") },
  { name: "rejects missing part-level synthetic truth", mutate: (item) => void delete item.parts[0]!.synthetic },
  { name: "rejects a mismatched Part sessionID", mutate: (item) => void (item.parts[0]!.sessionID = "ses_other") },
  { name: "rejects a mismatched Part messageID", mutate: (item) => void (item.parts[0]!.messageID = "msg_other") },
  { name: "rejects absent Part metadata", mutate: (item) => void delete item.parts[0]!.metadata },
  { name: "rejects non-object Part metadata", mutate: (item) => void (item.parts[0]!.metadata = "closure") },
  {
    name: "rejects an extra metadata key beside the reserved key",
    mutate: (item) => void ((item.parts[0]!.metadata as Payload).extra = true),
  },
  {
    name: "rejects a missing reserved metadata key",
    mutate: (item) => void delete (item.parts[0]!.metadata as Payload)[CLOSURE_RECORD_METADATA_KEY],
  },
  {
    name: "rejects a non-object reserved payload",
    mutate: (item) => void ((item.parts[0]!.metadata as Payload)[CLOSURE_RECORD_METADATA_KEY] = "closure"),
  },
  { name: "rejects the wrong version", mutate: (item) => void (payload(item).version = 2) },
  { name: "rejects an empty freeze owner", mutate: (item) => void (payload(item).freeze_owner_operation_id = "") },
  { name: "rejects a non-number generation", mutate: (item) => void (payload(item).generation = "1") },
  { name: "rejects a non-integer generation", mutate: (item) => void (payload(item).generation = 1.5) },
  { name: "rejects generation zero", mutate: (item) => void (payload(item).generation = 0) },
  { name: "rejects an empty fact key", mutate: (item) => void (payload(item).fact_key = "") },
  { name: "rejects an empty subject Session ID", mutate: (item) => void (payload(item).subject_session_id = "") },
  { name: "rejects a bad identity source", mutate: (item) => void (payload(item).identity_source = "copied") },
  {
    name: "rejects an absent prior-user source Message ID",
    mutate: (item) => void delete payload(item).source_user_message_id,
  },
  {
    name: "rejects source_user_message_id for session identity",
    mutate: (item) => void (payload(item).identity_source = "session_identity"),
  },
  {
    name: "rejects source_user_message_id for resume admission",
    mutate: (item) => void (payload(item).identity_source = "resume_admission"),
  },
  {
    name: "rejects a bad state at the fence",
    mutate: (item) => void (payload(item).state_at_fence = "running"),
  },
  {
    name: "rejects an unknown record kind",
    mutate: (item) => void (payload(item).record_kind = "branch"),
  },
  {
    name: "rejects a self payload missing its terminal key",
    mutate: (item) => void delete payload(item).terminal_outcome,
  },
  {
    name: "rejects a self payload with an extra key",
    mutate: (item) => void (payload(item).owner_session_id = "ses_owner"),
  },
  {
    name: "rejects a self subject outside the Message Session",
    mutate: (item) => void (payload(item).subject_session_id = "ses_other"),
  },
  {
    name: "rejects a bad self terminal outcome",
    mutate: (item) => void (payload(item).terminal_outcome = "running"),
  },
  { name: "rejects altered self sentence text", mutate: (item) => void (item.parts[0]!.text += " altered") },
  {
    name: "rejects an edge payload missing its child key",
    make: edge,
    mutate: (item) => void delete payload(item).child_session_id,
  },
  {
    name: "rejects an edge payload with an extra key",
    make: edge,
    mutate: (item) => void (payload(item).branch_outcome = "quiesced"),
  },
  {
    name: "rejects an edge owned by another Message Session",
    make: edge,
    mutate: (item) => void (payload(item).owner_session_id = "ses_other"),
  },
  {
    name: "rejects an edge whose subject is not its child",
    make: edge,
    mutate: (item) => void (payload(item).subject_session_id = "ses_other"),
  },
  {
    name: "rejects an empty edge child Session ID",
    make: edge,
    mutate: (item) => {
      payload(item).child_session_id = ""
      payload(item).subject_session_id = ""
    },
  },
  {
    name: "rejects an empty optional edge Task Part ID",
    make: edge,
    mutate: (item) => void (payload(item).task_part_id = ""),
  },
  {
    name: "rejects a bad edge terminal outcome",
    make: edge,
    mutate: (item) => void (payload(item).terminal_outcome = "running"),
  },
  {
    name: "rejects altered edge sentence text",
    make: edge,
    mutate: (item) => void (item.parts[0]!.text += " altered"),
  },
  {
    name: "rejects a root payload missing its branch-outcome key",
    make: root,
    mutate: (item) => void delete payload(item).branch_outcome,
  },
  {
    name: "rejects a root payload with an extra key",
    make: root,
    mutate: (item) => void (payload(item).child_session_id = "ses_child"),
  },
  {
    name: "rejects a root request outside the Message Session",
    make: root,
    mutate: (item) => void (payload(item).requested_root_session_id = "ses_other"),
  },
  {
    name: "rejects a root whose subject is not the requested root",
    make: root,
    mutate: (item) => void (payload(item).subject_session_id = "ses_other"),
  },
  {
    name: "rejects a non-quiesced branch outcome",
    make: root,
    mutate: (item) => void (payload(item).branch_outcome = "running"),
  },
  {
    name: "rejects a bad optional root terminal outcome",
    make: rootTerminal,
    mutate: (item) => void (payload(item).terminal_outcome = "running"),
  },
  {
    name: "rejects yielded root evidence without a terminal outcome",
    make: rootTerminal,
    mutate: (item) => void delete payload(item).terminal_outcome,
  },
  {
    name: "rejects altered quiescence-only root sentence text",
    make: root,
    mutate: (item) => void (item.parts[0]!.text += " altered"),
  },
  {
    name: "rejects altered terminal root sentence text",
    make: rootTerminal,
    mutate: (item) => void (item.parts[0]!.text += " altered"),
  },
]

describe("complete closure-pair classifier", () => {
  test("accepts the canonical self edge and root variants structurally", () => {
    const candidates: ClosureRecordCandidate[] = [self(), edge(), root(), rootTerminal()]
    expect(candidates.map(isCompleteClosurePair)).toEqual([true, true, true, true])
  })

  for (const rejection of rejections) {
    test(rejection.name, () => {
      const candidate = (rejection.make ?? self)()
      expect(isCompleteClosurePair(candidate)).toBe(true)
      rejection.mutate(candidate)
      expect(isCompleteClosurePair(candidate)).toBe(false)
    })
  }
})

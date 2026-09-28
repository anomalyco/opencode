// JSONL session record Schemas (ARCHITECTURE §7). They decode to the contract's SessionRecord types.
import { Schema } from "effect"
import type { SessionRecord } from "../contract"

const Profile = Schema.Literals(["default", "local", "local-min"])
const ToolStatus = Schema.Literals(["ok", "error", "denied", "timeout", "blocked"])
const RunState = Schema.Literals(["pending", "running", "completed", "failed", "cancelled"])
const Usage = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  reasoning: Schema.optional(Schema.Number),
  cache_read: Schema.optional(Schema.Number),
  estimated: Schema.Boolean,
})
const Common = { seq: Schema.Number, t: Schema.Number }
const turn = Schema.Number
const Strings = Schema.mutable(Schema.Array(Schema.String))

export const HeaderSchema = Schema.Struct({
  ...Common,
  type: Schema.Literal("session"),
  v: Schema.Literal(1),
  id: Schema.String,
  cwd: Schema.String,
  agent: Schema.String,
  model: Schema.String,
  profile: Profile,
  parent_id: Schema.optional(Schema.String),
  parent_call_id: Schema.optional(Schema.String),
  depth: Schema.Number,
  created_at: Schema.Number,
  title: Schema.optional(Schema.String),
})

export const RecordSchema = Schema.Union([
  HeaderSchema,
  Schema.Struct({
    ...Common,
    type: Schema.Literal("user"),
    turn,
    text: Schema.String,
    synthetic: Schema.Boolean,
    attachments: Schema.optional(
      Schema.mutable(Schema.Array(Schema.Struct({ kind: Schema.Literals(["file", "resource"]), ref: Schema.String, bytes: Schema.Number }))),
    ),
  }),
  Schema.Struct({ ...Common, type: Schema.Literal("reminder"), turn, text: Schema.String }),
  Schema.Struct({ ...Common, type: Schema.Literal("text"), turn, text: Schema.String }),
  Schema.Struct({ ...Common, type: Schema.Literal("reasoning"), turn, text: Schema.String }),
  Schema.Struct({ ...Common, type: Schema.Literal("tool_call"), turn, call_id: Schema.String, name: Schema.String, input: Schema.Unknown }),
  Schema.Struct({
    ...Common,
    type: Schema.Literal("tool_result"),
    turn,
    call_id: Schema.String,
    name: Schema.String,
    status: ToolStatus,
    output: Schema.String,
    overflow_path: Schema.optional(Schema.String),
    duration_ms: Schema.Number,
    bytes: Schema.Number,
  }),
  Schema.Struct({ ...Common, type: Schema.Literal("step"), turn, reason: Schema.String, usage: Usage }),
  Schema.Struct({
    ...Common,
    type: Schema.Literal("subagent"),
    call_id: Schema.String,
    child_id: Schema.String,
    agent: Schema.String,
    state: RunState,
    transport: Schema.Literals(["in-process", "mcp"]),
    background: Schema.Boolean,
  }),
  Schema.Struct({
    ...Common,
    type: Schema.Literal("permission"),
    request_id: Schema.String,
    tool: Schema.String,
    patterns: Strings,
    decision: Schema.Literals(["allow", "deny", "ask"]),
    reply: Schema.optional(Schema.Literals(["once", "always", "reject"])),
    via: Schema.Literals(["rule", "repl", "elicitation", "reply_tool", "timeout", "headless"]),
    always: Schema.optional(Strings),
  }),
  Schema.Struct({ ...Common, type: Schema.Literal("tools_activated"), names: Strings }),
  Schema.Struct({ ...Common, type: Schema.Literal("prune"), before_turn: Schema.Number }),
  Schema.Struct({ ...Common, type: Schema.Literal("compaction"), summary: Schema.String, through_seq: Schema.Number }),
  Schema.Struct({ ...Common, type: Schema.Literal("error"), message: Schema.String, retryable: Schema.Boolean }),
  Schema.Struct({ ...Common, type: Schema.Literal("end"), reason: Schema.Literals(["stop", "max_turns", "cancelled", "error"]), turns: Schema.Number, usage: Usage }),
])

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(RecordSchema))

/** One JSONL line → record, or undefined for a torn/unknown line (a crash mid-write leaves one at the tail). */
export function parseLine(line: string): SessionRecord | undefined {
  const decoded = decodeLine(line)
  return decoded._tag === "Some" ? decoded.value : undefined
}

// Compile-time guard: the Schemas and the contract's §7 types must stay the same shape both ways.
type Decoded = typeof RecordSchema.Type
export const check: [Decoded] extends [SessionRecord] ? ([SessionRecord] extends [Decoded] ? true : false) : false = true

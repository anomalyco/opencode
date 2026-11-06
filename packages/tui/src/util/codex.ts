import { Schema } from "effect"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionTransfer } from "@opencode/schema/session-transfer"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"

const Thread = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  cwd: Schema.String,
  rollout_path: Schema.String,
  created: Schema.Number,
  updated: Schema.Number,
})
export type CodexThread = typeof Thread.Type

const Row = Schema.Struct({
  item_json: Schema.String,
  created_at_ms: Schema.Number,
  completed_at_ms: Schema.NullOr(Schema.Number),
  turn_status: Schema.String,
})
const Part = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  image_url: Schema.optional(Schema.String),
})
const Item = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
  content: Schema.optional(Schema.Array(Part)),
  command: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  aggregatedOutput: Schema.optional(Schema.NullOr(Schema.String)),
  exitCode: Schema.optional(Schema.NullOr(Schema.Number)),
})
const Rollout = Schema.Struct({
  timestamp: Schema.String,
  type: Schema.String,
  payload: Schema.Struct({
    type: Schema.optional(Schema.String),
    role: Schema.optional(Schema.String),
    phase: Schema.optional(Schema.NullOr(Schema.String)),
    content: Schema.optional(Schema.Array(Part)),
    text: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  }),
})

export async function codexList(home: string): Promise<readonly CodexThread[]> {
  const { Database } = await import("bun:sqlite")
  const db = new Database(await databasePath(home, "state"), { readonly: true })
  try {
    return Schema.decodeUnknownSync(Schema.Array(Thread))(
      db
        .query(
          `SELECT id, title, cwd, rollout_path,
        COALESCE(created_at_ms, created_at * 1000) AS created,
        COALESCE(updated_at_ms, updated_at * 1000) AS updated
        FROM threads WHERE source NOT LIKE '%subagent%' ORDER BY updated DESC`,
        )
        .all(),
    )
  } finally {
    db.close()
  }
}

export async function codexTransfer(
  home: string,
  thread: CodexThread,
  selection: { agent: Agent.ID; model: Model.Ref },
): Promise<SessionTransfer.Data> {
  const { Database } = await import("bun:sqlite")
  const db = new Database(await databasePath(home, "thread_history"), { readonly: true })
  const recorded = (() => {
    try {
      return Schema.decodeUnknownSync(Schema.Array(Row))(
        db
          .query(
            `SELECT i.item_json, i.created_at_ms, i.completed_at_ms, t.status AS turn_status
          FROM thread_items i JOIN thread_turns t ON t.thread_id = i.thread_id AND t.turn_id = i.turn_id
          WHERE i.thread_id = ? ORDER BY i.rollout_ordinal, i.created_at_ms`,
          )
          .all(thread.id),
      )
    } finally {
      db.close()
    }
  })()
  const rows = recorded.length ? recorded : await rolloutRows(thread.rollout_path)
  const messages = rows.flatMap((row): unknown[] => {
    const raw = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(row.item_json)
    const item = Schema.decodeUnknownSync(Item)(raw)
    const base = {
      id: SessionMessage.ID.create(),
      time: { created: row.created_at_ms },
      metadata: { codex: { type: item.type } },
    }
    if (item.type === "userMessage") {
      const text =
        item.content
          ?.map((part) => part.text ?? `[${part.type}: ${part.path ?? part.image_url ?? "attachment"}]`)
          .join("\n") ?? ""
      return text ? [{ ...base, type: "user", text }] : []
    }
    if (item.type === "agentMessage") {
      if (!item.text || (row.turn_status === "inProgress" && row.completed_at_ms === null)) return []
      return [
        {
          ...base,
          type: "assistant",
          ...selection,
          content: [{ type: "text", text: item.text }],
          finish: "stop",
          time: { created: row.created_at_ms, completed: row.completed_at_ms ?? row.created_at_ms },
        },
      ]
    }
    if (item.status === "inProgress" || item.status === "running") return []
    if (item.type === "commandExecution") {
      return [
        {
          ...base,
          type: "system",
          description: "Codex command result",
          text: `Codex executed the following command:\n\nWorking directory: ${item.cwd ?? thread.cwd}\nCommand: ${item.command ?? ""}\nExit code: ${item.exitCode ?? "unknown"}\n\nOutput:\n${item.aggregatedOutput ?? ""}`,
        },
      ]
    }
    if (
      !["mcpToolCall", "dynamicToolCall", "fileChange", "webSearch", "imageView", "subAgentActivity"].includes(
        item.type,
      )
    )
      return []
    return [
      {
        ...base,
        type: "system",
        description: `Codex ${item.type}`,
        text: `Historical Codex ${item.type} record:\n${JSON.stringify(raw, null, 2)}`,
      },
    ]
  })
  if (messages.length === 0) throw new Error("このCodexセッションには取り込める履歴がありません。")
  return Schema.decodeUnknownSync(SessionTransfer.Data)({
    info: {
      id: Session.ID.create(),
      projectID: "global",
      title: thread.title,
      location: { directory: thread.cwd },
      ...selection,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: thread.created, updated: thread.updated },
      metadata: { codex: { threadID: thread.id } },
    },
    messages,
  })
}

async function databasePath(home: string, name: string) {
  const file = (await readdir(home))
    .filter((file) => new RegExp(`^${name}_\\d+\\.sqlite$`).test(file))
    .sort((a, b) => Number(b.match(/_(\d+)\.sqlite$/)?.[1]) - Number(a.match(/_(\d+)\.sqlite$/)?.[1]))[0]
  if (!file) throw new Error(`Codexの${name}データベースが見つかりません: ${home}`)
  return path.join(home, file)
}

async function rolloutRows(file: string) {
  const entries = (await Bun.file(file).text())
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => ({
      raw: Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(line),
      entry: Schema.decodeUnknownSync(Schema.fromJsonString(Rollout))(line),
    }))
  const hasMessages = entries.some(({ entry }) => entry.type === "response_item" && entry.payload.type === "message")
  return entries.flatMap(({ raw, entry }): (typeof Row.Type)[] => {
    const payload = entry.payload
    const time = Date.parse(entry.timestamp)
    if (entry.type === "response_item" && payload.type === "message") {
      if (payload.role === "user")
        return [
          {
            item_json: JSON.stringify({ type: "userMessage", content: payload.content }),
            created_at_ms: time,
            completed_at_ms: time,
            turn_status: "completed",
          },
        ]
      if (payload.role !== "assistant" || payload.phase === "analysis") return []
      return [
        {
          item_json: JSON.stringify({
            type: "agentMessage",
            text: payload.content?.map((part) => part.text ?? "").join("\n"),
          }),
          created_at_ms: time,
          completed_at_ms: time,
          turn_status: "completed",
        },
      ]
    }
    if (
      entry.type === "response_item" &&
      payload.type &&
      ["function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output"].includes(payload.type)
    ) {
      return [
        {
          item_json: JSON.stringify({ type: "dynamicToolCall", record: raw }),
          created_at_ms: time,
          completed_at_ms: time,
          turn_status: "completed",
        },
      ]
    }
    if (hasMessages || entry.type !== "event_msg") return []
    if (payload.type === "user_message")
      return [
        {
          item_json: JSON.stringify({ type: "userMessage", content: [{ type: "text", text: payload.message }] }),
          created_at_ms: time,
          completed_at_ms: time,
          turn_status: "completed",
        },
      ]
    if (payload.type !== "agent_message") return []
    return [
      {
        item_json: JSON.stringify({ type: "agentMessage", text: payload.message ?? payload.text }),
        created_at_ms: time,
        completed_at_ms: time,
        turn_status: "completed",
      },
    ]
  })
}

import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import type { RecordInput } from "../../src/contract"
import { make, replay } from "../../src/session/store"
import { registerSecret } from "../../src/util/redact"
import { tmpdir } from "../lib/tmp"

const usage = { input: 10, output: 2, estimated: false }
const header = { id: "", cwd: "/w", agent: "build", model: "local/m", profile: "local" as const, depth: 0, created_at: 1 }

async function setup() {
  const dir = await tmpdir()
  const store = make(path.join(dir.path, "sessions"))
  return {
    dir,
    store,
    run: <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect),
    write: (session: string, records: RecordInput[]) =>
      Effect.runPromise(Effect.forEach(records, (record) => store.append(session, record), { discard: true })),
    [Symbol.asyncDispose]: () => dir[Symbol.asyncDispose](),
  }
}

describe("session store", () => {
  test("JSONL round trip: header, seq/t, list and latest", async () => {
    await using env = await setup()
    const first = await env.run(env.store.create({ ...header, created_at: 1 }))
    const second = await env.run(env.store.create({ ...header, created_at: 2 }))
    await env.run(env.store.create({ ...header, created_at: 3, parent_id: second }))
    await env.write(first, [
      { type: "user", turn: 0, text: "hi", synthetic: false },
      { type: "text", turn: 0, text: "hello" },
      { type: "step", turn: 0, reason: "stop", usage },
      { type: "end", reason: "stop", turns: 1, usage },
    ])
    const records = await env.run(env.store.read(first))
    expect(records.map((record) => record.type)).toEqual(["session", "user", "text", "step", "end"])
    expect(records.map((record) => record.seq)).toEqual([0, 1, 2, 3, 4])
    expect(records.every((record) => record.t > 0)).toBe(true)
    expect(first.startsWith("ses_")).toBe(true)
    const text = await Bun.file(path.join(env.dir.path, "sessions", `${first}.jsonl`)).text()
    expect(text.trim().split("\n")).toHaveLength(5)
    // A fresh store (new process) continues the seq numbering.
    const reopened = make(path.join(env.dir.path, "sessions"))
    await Effect.runPromise(reopened.append(first, { type: "text", turn: 1, text: "again" }))
    expect((await Effect.runPromise(reopened.read(first))).at(-1)?.seq).toBe(5)
    expect((await env.run(env.store.list({ cwd: "/w" }))).map((item) => item.created_at)).toEqual([3, 2, 1])
    expect(await env.run(env.store.list({ cwd: "/other" }))).toEqual([])
    expect(await env.run(env.store.latest("/w"))).toBe(second)
    expect(replay(records).messages.map((message) => message.role)).toEqual(["user", "assistant"])
  })

  test("resume drops a trailing incomplete step and a torn line, replaying from the last tool result", async () => {
    await using env = await setup()
    const session = await env.run(env.store.create(header))
    await env.write(session, [
      { type: "user", turn: 0, text: "read a", synthetic: false },
      { type: "tool_call", turn: 0, call_id: "c1", name: "read", input: { filePath: "a" } },
      { type: "step", turn: 0, reason: "tool-calls", usage },
      { type: "tool_result", turn: 0, call_id: "c1", name: "read", status: "ok", output: "A", duration_ms: 1, bytes: 1 },
      // turn 1 crashed mid-way: text and a call were persisted, but no step and no result
      { type: "text", turn: 1, text: "now b" },
      { type: "tool_call", turn: 1, call_id: "c2", name: "read", input: { filePath: "b" } },
    ])
    await Bun.write(
      Bun.file(path.join(env.dir.path, "sessions", `${session}.jsonl`)),
      (await Bun.file(path.join(env.dir.path, "sessions", `${session}.jsonl`)).text()) + '{"seq":99,"t":1,"type":"te',
    )
    const records = await env.run(env.store.read(session))
    expect(records.at(-1)?.type).toBe("tool_call")
    const state = replay(records)
    expect(state.turn).toBe(2)
    expect(state.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"])
    expect(state.messages.at(-1)?.content[0]).toMatchObject({ type: "tool-result", id: "c1", result: { value: "A" } })
    expect(JSON.stringify(state.messages)).not.toContain("now b")
  })

  test("compaction and prune apply on replay", async () => {
    const records = [
      { type: "user", turn: 0, text: "old", synthetic: false },
      { type: "tool_call", turn: 0, call_id: "c1", name: "read", input: { filePath: "x.ts" } },
      { type: "step", turn: 0, reason: "tool-calls", usage },
      { type: "tool_result", turn: 0, call_id: "c1", name: "read", status: "ok", output: "BIG", duration_ms: 1, bytes: 3 },
      { type: "prune", before_turn: 1 },
    ].map((record, seq) => ({ ...record, seq, t: 1 })) as Parameters<typeof replay>[0]
    const pruned = replay(records)
    expect(JSON.stringify(pruned.messages)).toContain("[output elided: read x.ts, 3 B")
    expect(JSON.stringify(pruned.messages)).not.toContain("BIG")
    const compacted = replay([...records, { type: "compaction", summary: "SUMMARY", through_seq: 4, seq: 5, t: 1 }])
    expect(compacted.messages).toHaveLength(1)
    expect(compacted.messages[0].content[0]).toMatchObject({ type: "text", text: "SUMMARY" })
  })

  test("redacts apiKey, Authorization and MCP header values", async () => {
    await using env = await setup()
    registerSecret("sk-live-abcdef123456")
    const session = await env.run(env.store.create(header))
    await env.write(session, [
      { type: "user", turn: 0, text: "my key is sk-live-abcdef123456", synthetic: false },
      {
        type: "tool_call",
        turn: 0,
        call_id: "c1",
        name: "mcp__x__y",
        input: { apiKey: "plain-key-value", Authorization: "Bearer tok-777", headers: { "X-Custom": "hdr-secret-9" } },
      },
    ])
    const text = await Bun.file(path.join(env.dir.path, "sessions", `${session}.jsonl`)).text()
    ;["sk-live-abcdef123456", "plain-key-value", "tok-777", "hdr-secret-9"].forEach((secret) =>
      expect(text).not.toContain(secret),
    )
    expect(text).toContain("***")
  })
})

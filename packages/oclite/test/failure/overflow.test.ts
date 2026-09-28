// Phase 7: context overflow (the fake's `context_limit` 400). One forced compaction plus one retry; a second
// overflow ends the run instead of looping.
import { describe, expect, test } from "bun:test"
import { setup } from "../cli/harness"
import { reply, type ChatBody } from "../lib/local-server"
import { events, exportSession, spawn } from "./lib"

const SUMMARIZER = "context summarization agent"
const system = (body: ChatBody | undefined) => String(body?.messages?.find((message) => message.role === "system")?.content ?? "")

describe("context overflow", () => {
  test("400 → exactly one compaction, one retry, then success (exit 0)", async () => {
    await using env = await setup({ toggles: { context_limit: 4000, delta_chars: 2000 } })
    env.server.queue(reply.text("SUMMARY OF WORK"), reply.text("fits now"))
    const result = await spawn(env, ["-p", "x".repeat(30000), "--output-format", "stream-json"])
    expect(result.code).toBe(0)
    const chats = env.server.chats()
    expect(chats.map((chat) => chat.status)).toEqual([400, 200, 200])
    expect(chats.filter((chat) => system(chat.body).includes(SUMMARIZER))).toHaveLength(1)
    expect(JSON.stringify(chats[2]?.body?.messages)).toContain("SUMMARY OF WORK")
    const last = events(result.stdout).at(-1)
    expect(last).toMatchObject({ type: "result", state: "completed", text: "fits now", exit_code: 0 })
    const records = await exportSession(env, String(last?.session_id))
    expect(records.filter((record) => record.type === "compaction")).toHaveLength(1)
  }, 30_000)

  test("a second overflow after compaction → error, exit 1, no loop", async () => {
    await using env = await setup({ toggles: { context_limit: 4000, delta_chars: 2000 } })
    // A summary that is itself over the limit, so the retried request overflows again.
    env.server.queue(reply.text("S".repeat(20000)))
    const result = await spawn(env, ["-p", "x".repeat(30000), "--output-format", "stream-json"])
    expect(result.code).toBe(1)
    const main = env.server.chats().filter((chat) => !system(chat.body).includes(SUMMARIZER))
    expect(main.map((chat) => chat.status)).toEqual([400, 400])
    // Bounded: besides the forced compaction, the next turn's threshold check may try one more summary (it overflows
    // too and is reported as "compaction failed"); nothing beyond that.
    expect(env.server.chats().length).toBeLessThanOrEqual(4)
    const stream = events(result.stdout)
    const records = await exportSession(env, String(stream.at(-1)?.session_id))
    expect(records.filter((record) => record.type === "compaction")).toHaveLength(1)
    expect(records.at(-1)).toMatchObject({ type: "end", reason: "error" })
    expect(String(stream.find((event) => event.type === "error")?.message)).toContain("maximum context length")
    expect(stream.at(-1)).toMatchObject({ type: "result", state: "failed", exit_code: 1 })
  }, 30_000)
})

// Phase 7: the connection drops mid-stream; the loop retries and resumes from the last complete tool result,
// so a side-effecting tool never runs twice.
import { describe, expect, test } from "bun:test"
import { setup } from "../cli/harness"
import { reply } from "../lib/local-server"
import { events, exportSession, spawn } from "./lib"

const append = reply.tool_call({ name: "bash", args: { command: "echo x >> out.txt" } })
const lines = async (file: string) => (await Bun.file(file).text()).split("\n").filter(Boolean)

describe("mid-stream drop", () => {
  test("dropped after the tool call arrived but before finish: the call is not executed until the retry completes", async () => {
    // Chunks: role, tool start, 3 argument pieces → the whole call is on the wire, then the stream ends without finish.
    await using env = await setup({ toggles: { drop_after_chunks: 5 } })
    env.server.queue(append, reply.text("appended"))
    const result = await spawn(env, ["-p", "append", "--allowed-tools", "bash", "--output-format", "stream-json"])
    expect(result.code).toBe(0)
    expect(env.server.chats()[0]?.dropped).toBe(true)
    expect(await lines(`${env.project.path}/out.txt`)).toEqual(["x"])
    const stream = events(result.stdout)
    expect(stream.filter((event) => event.type === "tool_start")).toHaveLength(1)
    expect(stream.some((event) => event.type === "status" && event.phase === "retry")).toBe(true)
    expect(stream.at(-1)).toMatchObject({ type: "result", text: "appended", exit_code: 0 })
  }, 30_000)

  test("dropped on the turn after the tool result: resume from that result, no duplicate execution", async () => {
    await using env = await setup()
    env.server.queue(reply.tool_call({ name: "bash", args: { command: "echo x >> out.txt; sleep 0.5" } }), reply.text("done once"))
    const result = await spawn(env, ["-p", "append", "--allowed-tools", "bash", "--output-format", "stream-json"], {
      // The tool sleeps 0.5 s, so the drop is armed well before the next request goes out.
      onLine: (line) => {
        if (line.includes('"type":"tool_start"')) env.server.set({ drop_after_chunks: 2 })
      },
    })
    expect(result.code).toBe(0)
    const chats = env.server.chats()
    expect(chats.map((chat) => Boolean(chat.dropped))).toEqual([false, true, false])
    expect(await lines(`${env.project.path}/out.txt`)).toEqual(["x"])
    // The retried request carries the same, single tool result.
    const toolMessages = (index: number) => chats[index]?.body?.messages?.filter((message) => message.role === "tool") ?? []
    expect(toolMessages(2)).toHaveLength(1)
    expect(JSON.stringify(toolMessages(2))).toBe(JSON.stringify(toolMessages(1)))
    const last = events(result.stdout).at(-1)
    expect(last).toMatchObject({ type: "result", text: "done once", exit_code: 0 })
    const records = await exportSession(env, String(last?.session_id))
    expect(records.filter((record) => record.type === "tool_result")).toHaveLength(1)
    expect(records.filter((record) => record.type === "text")).toHaveLength(1)
    expect(records.at(-1)).toMatchObject({ type: "end", reason: "stop" })
  }, 30_000)
})

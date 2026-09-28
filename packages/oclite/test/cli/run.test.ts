// `oclite -p` end to end: subprocess against test/lib/local-server.ts (SPEC §1 output formats and exit codes).
import { describe, expect, test } from "bun:test"
import { reply } from "../lib/local-server"
import { setup } from "./harness"

describe("oclite -p (subprocess)", () => {
  test("--output-format json: one result object after glob → text, exit 0", async () => {
    await using env = await setup({ files: { "a.txt": "alpha", "b.txt": "beta" } })
    env.server.queue(reply.tool_call({ name: "glob", args: { pattern: "*.txt" } }))
    env.server.queue(reply.text("a.txt and b.txt"))
    const result = await env.spawn(["-p", "list files", "--output-format", "json"])
    expect(result.code).toBe(0)
    const lines = result.stdout.trim().split("\n")
    expect(lines).toHaveLength(1)
    const object = JSON.parse(lines[0]!)
    expect(object).toMatchObject({ type: "result", state: "completed", text: "a.txt and b.txt", turns: 2, exit_code: 0 })
    expect(object.session_id).toMatch(/^ses_/)
    const tool = env.server.chats()[1]!.body!.messages!.find((message) => message.role === "tool")
    expect(String(tool?.content)).toContain("a.txt")
  })

  test("text mode: stdout carries only the assistant text", async () => {
    await using env = await setup({ files: { "a.txt": "alpha" } })
    env.server.queue(reply.tool_call({ name: "read", args: { filePath: "a.txt" } }))
    env.server.queue(reply.text("it says alpha"))
    const result = await env.spawn(["-p", "read a.txt"])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe("it says alpha\n")
    expect(result.stderr).toContain("⚙ read a.txt")
    expect(result.stderr).toMatch(/✓ read a\.txt · \d+ ms · \d+ B/)
  })

  test("--max-turns reached headless → exit 3", async () => {
    await using env = await setup({ files: { "a.txt": "alpha" } })
    env.server.queue(reply.tool_call({ name: "read", args: { filePath: "a.txt" } }))
    env.server.queue(reply.tool_call({ name: "read", args: { filePath: "a.txt" } }))
    const result = await env.spawn(["-p", "loop", "--max-turns", "1"])
    expect(result.code).toBe(3)
    expect(result.stderr).toContain("max turns")
    expect(env.server.chats()).toHaveLength(1)
  })

  test("permission denial headless (write in default mode) → exit 3, file untouched", async () => {
    await using env = await setup()
    env.server.queue(reply.tool_call({ name: "write", args: { filePath: "x.txt", content: "X" } }))
    env.server.queue(reply.text("could not write"))
    const result = await env.spawn(["-p", "write x", "--output-format", "stream-json"])
    expect(result.code).toBe(3)
    const events = result.lines.map((item) => JSON.parse(item.line))
    expect(events.find((event) => event.type === "tool_end")).toMatchObject({ name: "write", status: "denied" })
    expect(events.at(-1)).toMatchObject({ type: "result", exit_code: 3 })
    expect(await Bun.file(`${env.project.path}/x.txt`).exists()).toBe(false)
  })

  test("text protocol: two malformed tool calls headless → exit 3 (denied counted before failed → 1)", async () => {
    await using env = await setup({ toggles: { tools: "text" }, pins: { tools_native: false } })
    env.server.queue(reply.malformed_tool_call('```json\n{"tool": "read", "args": {\n```'), reply.malformed_tool_call('```json\n{"tool": \n```'))
    const result = await env.spawn(["-p", "read a", "--output-format", "json"])
    expect(result.code).toBe(3)
    expect(JSON.parse(result.stdout)).toMatchObject({ type: "result", state: "failed", exit_code: 3 })
  })

  test("unreachable provider → exit 2 naming the base URL", async () => {
    await using env = await setup({ baseURL: "http://127.0.0.1:1/v1" })
    const result = await env.spawn(["-p", "hi"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("http://127.0.0.1:1/v1")
    expect(result.stdout).toBe("")
    const json = await env.spawn(["-p", "hi", "--output-format", "json"])
    expect(json.code).toBe(2)
    expect(JSON.parse(json.stdout)).toMatchObject({ type: "result", exit_code: 2, errors: [expect.stringContaining("127.0.0.1:1")] })
  })

  test("secrets in a credentialed base URL and apiKey never reach stdout/stderr in any format", async () => {
    await using env = await setup({ baseURL: "http://user:hunter22pass@127.0.0.1:1/v1?api_key=QQQ999key", apiKey: "sk-live-SECRET123" })
    const outputs = await Promise.all(["text", "json", "stream-json"].map((format) => env.spawn(["-p", "hi", "--output-format", format])))
    outputs.forEach((result) => {
      expect(result.code).toBe(2)
      ;["hunter22pass", "QQQ999key", "sk-live-SECRET123"].forEach((secret) => expect(result.stdout + result.stderr).not.toContain(secret))
    })
    expect(outputs[2]!.stdout).toContain("127.0.0.1:1")
  })

  test("bypassPermissions prints a startup notice on stderr", async () => {
    await using env = await setup()
    env.server.queue(reply.text("ok"))
    const result = await env.spawn(["-p", "hi", "--permission-mode", "bypassPermissions"])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe("ok\n")
    expect(result.stderr).toContain("permission mode bypassPermissions: all tools allowed except .env access and your explicit deny rules")
    const repl = await env.spawn(["--permission-mode", "bypassPermissions"], { stdin: "/exit\n" })
    expect(repl.stderr).toContain("permission mode bypassPermissions")
  })

  test("SIGINT mid-turn → exit 130, result event still emitted, session ends cancelled", async () => {
    await using env = await setup({ toggles: { hang: true } })
    const sent = { done: false }
    const result = await env.spawn(["-p", "wait", "--output-format", "stream-json"], {
      onLine: (line, proc) => {
        if (sent.done || !line.includes('"type":"system"')) return
        sent.done = true
        // The request goes out right after the system event; give it a moment to reach the hanging server.
        setTimeout(() => proc.kill("SIGINT"), 150)
      },
    })
    expect(result.code).toBe(130)
    const last = JSON.parse(result.lines.at(-1)!.line)
    expect(last).toMatchObject({ type: "result", state: "cancelled", exit_code: 130 })
    const records = await env.spawn(["session", "export", last.session_id])
    expect(records.stdout.trim().split("\n").map((line) => JSON.parse(line)).at(-1)).toMatchObject({ type: "end", reason: "cancelled" })
  })

  test("--continue and --resume carry the conversation; session list/show", async () => {
    await using env = await setup()
    env.server.queue(reply.text("first answer"))
    const first = JSON.parse((await env.spawn(["-p", "remember kiwi", "--output-format", "json"])).stdout)
    env.server.queue(reply.text("kiwi"))
    const second = JSON.parse((await env.spawn(["-p", "what fruit?", "--continue", "--output-format", "json"])).stdout)
    expect(second.session_id).toBe(first.session_id)
    expect(JSON.stringify(env.server.chats()[1]!.body!.messages)).toContain("remember kiwi")
    env.server.queue(reply.text("still kiwi"))
    const third = await env.spawn(["-p", "again?", "--resume", first.session_id])
    expect(third.code).toBe(0)
    expect(JSON.stringify(env.server.chats()[2]!.body!.messages)).toContain("first answer")
    const list = await env.spawn(["session", "list"])
    expect(list.stdout).toContain(first.session_id)
    const show = await env.spawn(["session", "show", first.session_id])
    expect(show.stdout).toContain("> remember kiwi")
    expect(show.stdout).toContain("still kiwi")
    const unknown = await env.spawn(["-p", "x", "--resume", "ses_nope"])
    expect(unknown.code).toBe(2)
    const none = await env.spawn(["session", "show", "ses_nope"])
    expect(none.code).toBe(2)
  })
})

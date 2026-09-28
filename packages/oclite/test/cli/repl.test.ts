// REPL with scripted (non-TTY) stdin against local-server: prompts, slash commands, @path, the REPL Asker.
import { describe, expect, test } from "bun:test"
import { reply } from "../lib/local-server"
import { setup } from "./harness"

describe("oclite REPL (scripted stdin)", () => {
  test("prompt, /cost, /exit", async () => {
    await using env = await setup()
    env.server.queue(reply.text("hello there"))
    const result = await env.spawn([], { stdin: "hi\n/cost\n/help\n/mcp\n/bogus\n/exit\nnever sent\n" })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("hello there")
    expect(result.stdout).toMatch(/cost: ses_\w+ · steps 1 · in \d+ \/ out \d+ tok/)
    expect(result.stdout).toContain("/compact")
    expect(result.stdout).toContain("phase 4")
    expect(result.stdout).toContain("unknown command /bogus")
    expect(env.server.chats()).toHaveLength(1)
  })

  test("turns share a session; /clear starts a new one; @path attaches the file", async () => {
    await using env = await setup({ files: { "notes.txt": "kiwi is the password" } })
    env.server.queue(reply.text("one"), reply.text("two"), reply.text("three"))
    const result = await env.spawn([], { stdin: "first @notes.txt\nsecond\n/clear\nthird\n" })
    expect(result.code).toBe(0)
    const chats = env.server.chats().map((chat) => JSON.stringify(chat.body!.messages))
    expect(chats[0]).toContain("kiwi is the password")
    expect(chats[1]).toContain("first @notes.txt")
    expect(chats[2]).not.toContain("first @notes.txt")
    expect(result.stdout).toContain("new session")
  })

  test("REPL Asker: y allows the write, n denies it", async () => {
    await using env = await setup()
    env.server.queue(reply.tool_call({ name: "write", args: { filePath: "yes.txt", content: "Y" } }), reply.text("wrote"))
    env.server.queue(reply.tool_call({ name: "write", args: { filePath: "no.txt", content: "N" } }), reply.text("skipped"))
    const result = await env.spawn([], { stdin: "write yes\ny\nwrite no\nn\n" })
    expect(result.code).toBe(0)
    expect(result.stderr).toContain("[y]es / [a]lways / [n]o")
    expect(await env.project.read("yes.txt")).toBe("Y")
    expect(await Bun.file(`${env.project.path}/no.txt`).exists()).toBe(false)
    expect(result.stderr).toMatch(/✗ write no\.txt · denied/)
  })
})

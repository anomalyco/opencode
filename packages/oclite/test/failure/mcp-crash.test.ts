// Phase 7: an MCP server dies in the middle of a tool call (fixture `crash`).
import { describe, expect, test } from "bun:test"
import { setup } from "../cli/harness"
import { reply } from "../lib/local-server"
import { events, spawn, withFixture } from "./lib"

describe("MCP server dies mid-call", () => {
  test("-p stream-json: tool error reported, the run reaches a final answer, exit 0", async () => {
    await using env = await setup()
    await withFixture(env)
    env.server.queue(reply.tool_call({ name: "mcp__fixture__crash", args: {} }), reply.text("the fixture crashed"))
    const result = await spawn(env, ["-p", "crash it", "--profile", "default", "--allowed-tools", "mcp__fixture__*", "--output-format", "stream-json"])
    expect(result.code).toBe(0)
    const stream = events(result.stdout)
    expect(stream.find((event) => event.type === "system")).toMatchObject({ mcp: [{ name: "fixture", status: "connected" }] })
    expect(stream.find((event) => event.type === "tool_end")).toMatchObject({ name: "mcp__fixture__crash", status: "error" })
    expect(stream.at(-1)).toMatchObject({ type: "result", state: "completed", text: "the fixture crashed", exit_code: 0 })
    // The model saw the failure as the tool result, not a silent success.
    expect(JSON.stringify(env.server.chats()[1]?.body?.messages)).toMatch(/[Cc]onnection closed/)
  }, 30_000)

  test("REPL: /mcp shows the server failed after the crash, and the next turn still runs", async () => {
    await using env = await setup()
    await withFixture(env)
    env.server.queue(reply.tool_call({ name: "mcp__fixture__crash", args: {} }), reply.text("it crashed"), reply.text("still here"))
    const result = await spawn(env, ["--profile", "default", "--allowed-tools", "mcp__fixture__*"], {
      stdin: "crash it\n/mcp\nanything else?\n",
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/fixture: failed — connection closed/)
    expect(result.stdout).toContain("still here")
    // With the server gone its tools leave the next request.
    const names = (env.server.chats()[2]?.body?.tools ?? []).map((tool) => (tool as { function: { name: string } }).function.name)
    expect(names.some((name) => name.startsWith("mcp__fixture__"))).toBe(false)
  }, 30_000)
})

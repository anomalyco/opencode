import { describe, expect, test } from "bun:test"
import path from "path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { ToolListChangedNotificationSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { tmpdir } from "../lib/tmp"

const fixture = path.join(import.meta.dir, "mcp-everything.ts")

async function connect(env: Record<string, string> = {}) {
  const client = new Client({ name: "fixture-test", version: "1.0.0" })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fixture],
    env: { PATH: process.env.PATH ?? "", ...env },
    stderr: "pipe",
  })
  await client.connect(transport)
  return { client, transport, [Symbol.asyncDispose]: () => client.close() }
}

function textOf(result: unknown) {
  const content = (result as CallToolResult).content
  return content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("")
}

describe("mcp-everything fixture", () => {
  test("lists tools with annotations and sets instructions", async () => {
    await using mcp = await connect()
    const tools = (await mcp.client.listTools()).tools
    expect(tools.map((tool) => tool.name).sort()).toEqual(["add", "crash", "echo", "lookup", "slow", "write_file"])
    expect(tools.find((tool) => tool.name === "lookup")?.annotations?.readOnlyHint).toBe(true)
    expect(tools.find((tool) => tool.name === "write_file")?.annotations?.readOnlyHint).toBe(false)
    expect(mcp.client.getInstructions()).toContain("Fixture server")
  })

  test("echo, add, lookup", async () => {
    await using mcp = await connect()
    expect(textOf(await mcp.client.callTool({ name: "echo", arguments: { text: "hi" } }))).toBe("hi")
    expect(textOf(await mcp.client.callTool({ name: "add", arguments: { a: 2, b: 3 } }))).toBe("5")
    expect(textOf(await mcp.client.callTool({ name: "lookup", arguments: { key: "alpha" } }))).toBe("1")
    const missing = await mcp.client.callTool({ name: "lookup", arguments: { key: "zzz" } })
    expect(missing.isError).toBe(true)
  })

  test("slow sends progress notifications when a progress handler is given", async () => {
    await using mcp = await connect()
    const progress: number[] = []
    const result = await mcp.client.callTool({ name: "slow", arguments: { steps: 3, ms: 20 } }, undefined, {
      onprogress: (event) => progress.push(event.progress),
      resetTimeoutOnProgress: true,
      timeout: 5000,
    })
    expect(textOf(result)).toBe("done after 3 steps")
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.every((value, i) => i === 0 || value > progress[i - 1])).toBe(true)
    expect(progress.at(-1)).toBe(3)
  })

  test("slow times out without progress resets", async () => {
    await using mcp = await connect()
    const outcome = await mcp.client
      .callTool({ name: "slow", arguments: { steps: 1, ms: 500 } }, undefined, { timeout: 100 })
      .then(
        () => "resolved",
        (error: Error) => error.message,
      )
    expect(outcome).toContain("timed out")
  })

  test("crash exits the process mid-call and the call rejects", async () => {
    await using mcp = await connect()
    const closed = new Promise<void>((resolve) => {
      mcp.client.onclose = resolve
    })
    const outcome = await mcp.client.callTool({ name: "crash", arguments: {} }, undefined, { timeout: 5000 }).then(
      () => "resolved",
      (error: Error) => error.message,
    )
    expect(outcome).not.toBe("resolved")
    await closed
  })

  test("write_file writes only inside FIXTURE_WRITE_DIR; dry run without it", async () => {
    await using dir = await tmpdir()
    await using mcp = await connect({ FIXTURE_WRITE_DIR: dir.path })
    const ok = await mcp.client.callTool({ name: "write_file", arguments: { path: "a.txt", content: "hello" } })
    expect(ok.isError).toBeFalsy()
    expect(await dir.read("a.txt")).toBe("hello")
    const escape = await mcp.client.callTool({ name: "write_file", arguments: { path: "../escape.txt", content: "x" } })
    expect(escape.isError).toBe(true)
    expect(await Bun.file(path.join(dir.path, "../escape.txt")).exists()).toBe(false)

    await using dry = await connect()
    expect(textOf(await dry.client.callTool({ name: "write_file", arguments: { path: "b.txt", content: "x" } }))).toContain(
      "dry run",
    )
  })

  test("prompt greet", async () => {
    await using mcp = await connect()
    const prompts = (await mcp.client.listPrompts()).prompts
    expect(prompts.map((prompt) => prompt.name)).toEqual(["greet"])
    expect(prompts[0].arguments?.[0]).toMatchObject({ name: "name", required: true })
    const prompt = await mcp.client.getPrompt({ name: "greet", arguments: { name: "Ada" } })
    expect(prompt.messages[0].role).toBe("user")
    expect(prompt.messages[0].content).toEqual({ type: "text", text: "Please greet Ada warmly." })
  })

  test("resources: readme and item template", async () => {
    await using mcp = await connect()
    expect((await mcp.client.listResources()).resources.map((item) => item.uri)).toEqual(["fixture://readme"])
    expect((await mcp.client.listResourceTemplates()).resourceTemplates.map((item) => item.uriTemplate)).toEqual([
      "fixture://item/{id}",
    ])
    const readme = await mcp.client.readResource({ uri: "fixture://readme" })
    expect(readme.contents[0]).toMatchObject({ uri: "fixture://readme", text: expect.stringContaining("fixture") })
    const item = await mcp.client.readResource({ uri: "fixture://item/42" })
    expect(item.contents[0]).toMatchObject({ text: "item 42" })
  })

  test("FIXTURE_LIST_CHANGED=1 emits tools/list_changed after the first list and adds a tool", async () => {
    await using mcp = await connect({ FIXTURE_LIST_CHANGED: "1" })
    const changed = new Promise<void>((resolve) =>
      mcp.client.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve()),
    )
    expect((await mcp.client.listTools()).tools.map((tool) => tool.name)).not.toContain("late")
    await changed
    expect((await mcp.client.listTools()).tools.map((tool) => tool.name)).toContain("late")
  })

  test("no list_changed without the env toggle", async () => {
    await using mcp = await connect()
    const seen: string[] = []
    mcp.client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      seen.push("changed")
    })
    await mcp.client.listTools()
    await Bun.sleep(100)
    expect(seen).toEqual([])
  })
})

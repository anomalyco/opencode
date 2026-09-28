import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Schema } from "effect"
import { Tool } from "@opencode-ai/llm"
import READ from "@/tool/read.txt"
import type { OcliteTool } from "../../src/contract"
import { tmpdir } from "../lib/tmp"
import { agent, config, PROFILE, toolset } from "./harness"

function mcpTool(name: string, readOnly: boolean): OcliteTool {
  return {
    name,
    tool: Tool.make({
      description: `[fixture] ${name}`,
      jsonSchema: { type: "object", properties: { q: { type: "string" } } },
      execute: (input) => Effect.succeed(`ran ${JSON.stringify(input)}`),
    }),
    access: () => ({ permission: name, patterns: ["*"] }),
    readOnly,
    timeoutMs: 30_000,
    summarize: () => name,
  }
}

describe("registry", () => {
  test("definitions are sorted, byte-stable across reads, and use opencode's .txt in the default profile", async () => {
    await using dir = await tmpdir()
    const tools = await toolset(config(dir.path))
    const names = tools.set.definitions.map((item) => item.name)
    expect(names).toEqual([...names].sort())
    expect(names).not.toContain("question")
    expect(JSON.stringify(tools.set.definitions)).toBe(JSON.stringify(tools.set.definitions))
    expect(tools.set.definitions.find((item) => item.name === "read")?.description).toBe(READ)
    expect(tools.set.definitions.find((item) => item.name === "bash")?.description).toContain("120000ms")
    expect([...tools.set.readOnly].sort()).toEqual(["glob", "grep", "read", "skill", "webfetch"])
  })

  test("the profile resolver supplies descriptions; the profile limits the tool list", async () => {
    await using dir = await tmpdir()
    const tools = await toolset(config(dir.path), {
      profile: { ...PROFILE, name: "local-min", tools: ["bash", "edit", "grep", "read"] },
      describe: (profile, name) => `${profile.name}:${name}`,
    })
    expect(tools.set.definitions.map((item) => [item.name, item.description])).toEqual([
      ["bash", "local-min:bash"],
      ["edit", "local-min:edit"],
      ["grep", "local-min:grep"],
      ["read", "local-min:read"],
    ])
  })

  test("read_only agents don't see edit/write/mcp tools, except readOnlyHint MCP tools", async () => {
    await using dir = await tmpdir()
    const extra = [mcpTool("mcp__fixture__lookup", true), mcpTool("mcp__fixture__write_file", false)]
    const tools = await toolset(config(dir.path), {
      agent: agent({ name: "plan", read_only: true }),
      extra,
      mcpReadOnly: ["mcp__fixture__lookup"],
    })
    const names = tools.set.definitions.map((item) => item.name)
    expect(names).not.toContain("edit")
    expect(names).not.toContain("write")
    expect(names).toContain("bash")
    expect(names.filter((name) => name.startsWith("mcp__"))).toEqual(["mcp__fixture__lookup"])
    expect((await tools.call("mcp__fixture__lookup", { q: "k" })).status).toBe("ok")
    expect((await tools.call("mcp__fixture__write_file", {})).text).toBe("Unknown tool: mcp__fixture__write_file")
  })

  test("deferred MCP tools join the definitions after activate()", async () => {
    await using dir = await tmpdir()
    const cfg = config(dir.path, { permission: [{ permission: "mcp__*", pattern: "*", action: "allow" }] })
    const tools = await toolset(cfg, {
      profile: { ...PROFILE, mcp: "deferred" },
      extra: [mcpTool("mcp__fixture__echo", true)],
    })
    expect(tools.set.definitions.map((item) => item.name)).not.toContain("mcp__fixture__echo")
    await Effect.runPromise(tools.set.activate(["mcp__fixture__echo", "mcp__unknown__x"]))
    expect(tools.set.definitions.map((item) => item.name)).toContain("mcp__fixture__echo")
    expect(tools.set.definitions.map((item) => item.name)).not.toContain("mcp__unknown__x")
    expect((await tools.call("mcp__fixture__echo", { q: "hi" })).text).toBe('ran {"q":"hi"}')
  })

  test("PreToolUse exit 2 blocks the call with the hook's stderr; the tool never runs", async () => {
    await using dir = await tmpdir()
    const cfg = config(dir.path, {
      permission: [{ permission: "bash", pattern: "*", action: "allow" }],
      hooks: {
        PreToolUse: [{ matcher: "Bash", command: "echo no bash today >&2; exit 2", timeout_ms: 5000 }],
        PostToolUse: [],
        Stop: [],
      },
    })
    const tools = await toolset(cfg)
    const result = await tools.call("bash", { command: "touch ran" })
    expect(result).toMatchObject({ status: "blocked", text: "blocked: no bash today" })
    expect(await Bun.file(path.join(dir.path, "ran")).exists()).toBe(false)
  })

  test("PostToolUse sees the output; exit 2 appends its message for the model", async () => {
    await using dir = await tmpdir({ files: { "a.txt": "hello" } })
    const seen = path.join(dir.path, "seen.json")
    const cfg = config(dir.path, {
      hooks: {
        PreToolUse: [],
        PostToolUse: [{ matcher: "read", command: `cat > ${seen}; echo careful >&2; exit 2`, timeout_ms: 5000 }],
        Stop: [],
      },
    })
    const tools = await toolset(cfg)
    const result = await tools.call("read", { filePath: "a.txt" })
    expect(result.text).toEndWith("<hook>careful</hook>")
    const payload = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(await Bun.file(seen).text()) as Record<
      string,
      unknown
    >
    expect(payload.hook_event_name).toBe("PostToolUse")
    expect(String(payload.tool_output)).toContain("1: hello")
  })
})

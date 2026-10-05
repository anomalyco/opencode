import { describe, expect, test } from "bun:test"
import type { McpServer } from "@agentclientprotocol/sdk"
import { Schema } from "effect"
import { currentValue } from "./select-options"
import { makeSession, rpcError, secondModel, startWire, type Wire } from "./wire-fixture"

describe("acp session lifecycle over the wire", () => {
  test("initialize advertises capabilities, negotiates the version, and offers terminal auth only when asked", async () => {
    await using acp = await startWire()

    const plain = await acp.initialize()
    const terminal = await acp.initialize({ terminalAuth: true, childSessionUpdates: true })

    expect(plain).toMatchObject({
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        mcpCapabilities: { http: true, sse: false },
        promptCapabilities: { embeddedContext: true, image: true },
        sessionCapabilities: { additionalDirectories: {}, close: {}, delete: {}, fork: {}, list: {}, resume: {} },
        _meta: { "opencode/child-session-updates": true },
      },
      agentInfo: { name: "OpenCode" },
    })
    expect(plain.authMethods).toEqual([
      { id: "opencode-login", name: "Login with opencode", description: "Run `opencode auth login` in the terminal" },
    ])
    expect(terminal.authMethods?.[0]?._meta).toEqual({
      "terminal-auth": { command: "opencode", args: ["auth", "login"], label: "OpenCode Login" },
    })
    expect(await acp.request("authenticate", { methodId: "opencode-login" })).toEqual({})
    expect(await rpcError(acp.request("authenticate", { methodId: "missing" }))).toMatchObject({
      code: -32602,
      data: { methodId: "missing" },
    })
    expect((await acp.request("initialize", { protocolVersion: 99 })).protocolVersion).toBe(1)
  })

  test("loads with paginated replay while resume and fork do not replay", async () => {
    await using acp = await startWire()
    const history = Array.from({ length: 201 }, (_, index) => ({
      id: `msg_${index}`,
      type: "user" as const,
      text: `message ${index}`,
      time: { created: index },
    }))
    acp.server.sessions.set(
      "ses_loaded",
      makeSession("ses_loaded", {
        agent: "plan",
        model: { providerID: "test", id: secondModel.id, variant: "medium" },
      }),
    )
    acp.server.messages.set("ses_loaded", history)
    acp.server.sessions.set(
      "ses_resume",
      makeSession("ses_resume", { agent: "plan", model: { providerID: "test", id: secondModel.id, variant: "low" } }),
    )
    acp.server.messages.set("ses_resume", [{ id: "msg_resume", type: "user", text: "hidden", time: { created: 1 } }])
    await acp.initialize()

    const loaded = await acp.request("session/load", { cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] })
    const resumed = await acp.request("session/resume", { cwd: "/workspace", sessionId: "ses_resume", mcpServers: [] })
    const forked = await acp.request("session/fork", { cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] })

    expect(
      await rpcError(acp.request("session/load", { cwd: "/elsewhere", sessionId: "ses_loaded", mcpServers: [] })),
    ).toMatchObject({ code: -32602, data: { sessionId: "ses_loaded", cwd: "/elsewhere" } })
    expect(
      await rpcError(acp.request("session/load", { cwd: "/workspace", sessionId: "ses_missing", mcpServers: [] })),
    ).toMatchObject({ code: -32602, data: { sessionId: "ses_missing" } })
    expect(currentValue(loaded, "model")).toBe("test/second-model")
    expect(currentValue(loaded, "effort")).toBe("medium")
    expect(currentValue(loaded, "mode")).toBe("plan")
    expect(currentValue(resumed, "effort")).toBe("low")
    expect(currentValue(forked, "effort")).toBe("medium")
    expect(acp.server.sessions.has(forked.sessionId)).toBe(true)
    const replayed = (sessionId: string) =>
      acp.updates.flatMap((item) =>
        item.sessionId === sessionId && item.update.sessionUpdate === "user_message_chunk"
          ? [item.update.messageId]
          : [],
      )
    expect(replayed("ses_loaded")).toEqual(history.map((message) => message.id))
    expect(replayed(forked.sessionId)).toEqual([])
    expect(replayed("ses_resume")).toEqual([])
    expect(
      acp.updates.find((item) => item.sessionId === "ses_loaded" && item.update.sessionUpdate === "user_message_chunk")
        ?.update,
    ).toEqual({
      sessionUpdate: "user_message_chunk",
      messageId: "msg_0",
      content: { type: "text", text: "message 0" },
    })
  })

  test("publishes a session's commands after the response that attaches it", async () => {
    await using acp = await startWire()
    acp.server.sessions.set("ses_loaded", makeSession("ses_loaded"))
    acp.server.messages.set("ses_loaded", [{ id: "msg_0", type: "user", text: "hello", time: { created: 0 } }])
    await acp.initialize()
    const params = { cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }

    expect(await untilCommands(acp, () => acp.newSession())).toEqual(["response", "available_commands_update"])
    expect(await untilCommands(acp, () => acp.request("session/load", params))).toEqual([
      "user_message_chunk",
      "response",
      "available_commands_update",
    ])
    expect(await untilCommands(acp, () => acp.request("session/resume", params))).toEqual([
      "response",
      "available_commands_update",
    ])
    expect(await untilCommands(acp, () => acp.request("session/fork", params))).toEqual([
      "response",
      "available_commands_update",
    ])
  })

  test("converts MCP configs and deduplicates registrations per session and config", async () => {
    const local: McpServer = {
      name: "tools",
      command: "bun",
      args: ["server.ts"],
      env: [{ name: "TOKEN", value: "x" }],
    }
    const changed: McpServer = { ...local, args: ["changed.ts"] }
    const remote: McpServer = {
      type: "http",
      name: "docs",
      url: "https://example.com/mcp",
      headers: [{ name: "Authorization", value: "Bearer x" }],
    }
    await using acp = await startWire()
    await acp.initialize()

    const first = await acp.newSession("/workspace", [local, local, remote])
    await acp.request("session/resume", { cwd: "/workspace", sessionId: first.sessionId, mcpServers: [local, remote] })
    await acp.request("session/resume", { cwd: "/workspace", sessionId: first.sessionId, mcpServers: [changed] })
    await acp.request("session/resume", { cwd: "/workspace", sessionId: first.sessionId, mcpServers: [local] })

    const localConfig = (args: string[]) => ({
      name: "tools",
      directory: "/workspace",
      config: { type: "local", command: ["bun", ...args], environment: { TOKEN: "x" } },
    })
    expect(acp.server.mcp.filter((item) => item.name === "tools")).toEqual([
      localConfig(["server.ts"]),
      localConfig(["changed.ts"]),
      localConfig(["server.ts"]),
    ])

    await acp.newSession("/workspace", [local])

    expect(acp.server.mcp).toHaveLength(5)
    expect(acp.server.mcp.filter((item) => item.name === "tools")).toEqual([
      localConfig(["server.ts"]),
      localConfig(["changed.ts"]),
      localConfig(["server.ts"]),
      localConfig(["server.ts"]),
    ])
    expect(acp.server.mcp.find((item) => item.name === "docs")).toEqual({
      name: "docs",
      directory: "/workspace",
      config: { type: "remote", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" }, oauth: false },
    })
  })
  test("rejects MCP-over-ACP and SSE servers before creating or loading a session", async () => {
    await using acp = await startWire()
    acp.server.sessions.set("ses_saved", makeSession("ses_saved"))
    await acp.initialize()
    const existing = new Set(acp.server.sessions.keys())
    const mcpServers: McpServer[] = [{ type: "acp", name: "client", serverId: "mcp_client" }]
    const sse: McpServer[] = [{ type: "sse", name: "events", url: "https://example.com/sse", headers: [] }]
    const invalid = {
      code: -32602,
      message: "Invalid params: Only stdio and HTTP MCP servers are supported",
      data: { field: "mcpServers" },
    }

    expect(await rpcError(acp.newSession("/workspace", mcpServers))).toEqual(invalid)
    expect(await rpcError(acp.newSession("/workspace", sse))).toEqual(invalid)
    expect(
      await rpcError(acp.request("session/load", { cwd: "/workspace", sessionId: "ses_saved", mcpServers })),
    ).toEqual(invalid)
    expect(new Set(acp.server.sessions.keys())).toEqual(existing)
    expect(acp.server.requests.filter((request) => request.path.includes("ses_saved"))).toEqual([])
    expect(acp.logs).toEqual([])
  })
})

const isSessionUpdate = Schema.is(
  Schema.Struct({
    method: Schema.Literal("session/update"),
    params: Schema.Struct({ update: Schema.Struct({ sessionUpdate: Schema.String }) }),
  }),
)

// Labels what the agent sends from the request until the commands that follow it, in wire order.
async function untilCommands(acp: Wire, send: () => Promise<unknown>) {
  const start = acp.received.length
  await send()
  return acp.until(() => {
    const labels = acp.received.slice(start).map((message) => {
      if (isSessionUpdate(message)) return message.params.update.sessionUpdate
      return "method" in message ? message.method : "response"
    })
    return labels.includes("available_commands_update") && labels
  }, "available commands")
}

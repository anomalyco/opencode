import { describe, expect, test } from "bun:test"
import type { McpServer, SessionNotification } from "@agentclientprotocol/sdk"
import { Schema } from "effect"
import { currentValue } from "./select-options"
import {
  ephemeralEvent,
  makeSession,
  rpcError,
  secondModel,
  startSession,
  startWire,
  testModel,
  type Wire,
} from "./wire-fixture"

describe("acp session lifecycle over the wire", () => {
  test("initialize advertises capabilities and terminal auth only when the client asks", async () => {
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
  })

  test("creates a v2 session, registers mcp, and publishes commands", async () => {
    await using acp = await startWire()
    acp.server.catalog.commands = [{ name: "review" }]
    await acp.initialize()

    const result = await acp.newSession("/workspace", [
      { name: "docs", command: "bun", args: ["docs.ts"], env: [{ name: "TOKEN", value: "x" }] },
    ])

    expect(acp.server.sessions.get(result.sessionId)?.location.directory).toBe("/workspace")
    expect(result.configOptions?.map((option) => option.id)).toEqual(["model", "effort", "mode"])
    expect(acp.server.mcp).toEqual([
      {
        name: "docs",
        directory: "/workspace",
        config: { type: "local", command: ["bun", "docs.ts"], environment: { TOKEN: "x" } },
      },
    ])
    expect(await acp.waitForUpdate((item) => item.update.sessionUpdate === "available_commands_update")).toEqual({
      sessionId: result.sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "review", description: "" },
          { name: "compact", description: "Compact the session" },
        ],
      },
    })
  })

  test("does not persist the first catalog variant when no explicit default exists", async () => {
    await using acp = await startWire()
    acp.server.catalog.models = [{ ...secondModel, variants: [{ id: "none" }, { id: "high" }] }]
    await acp.initialize()

    const created = await acp.newSession()

    expect(currentValue(created, "effort")).toBe("default")
    expect(acp.server.sessions.get(created.sessionId)?.model).toBeUndefined()
    expect(acp.server.selections).toEqual([])
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

  test("does not publish commands for a session closed before its load responds", async () => {
    const held = Promise.withResolvers<undefined>()
    await using acp = await startWire({
      fetch: (request) => (request.path === "/api/session/ses_loaded/message" ? held.promise : undefined),
    })
    acp.server.sessions.set("ses_loaded", makeSession("ses_loaded"))
    await acp.initialize()

    const loaded = acp.request("session/load", { cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] })
    await acp.until(() => acp.server.requests.some((item) => item.path === "/api/session/ses_loaded/message"))
    await acp.request("session/close", { sessionId: "ses_loaded" })
    held.resolve(undefined)
    await loaded
    // A later session's commands follow the load response, giving a stray update time to arrive.
    const created = await acp.newSession()
    await acp.until(() => acp.updates.some(isCommands), "commands for the later session")

    expect(acp.updates.filter(isCommands).map((item) => item.sessionId)).toEqual([created.sessionId])
  })

  test("detaches a session whose load fails after attaching", async () => {
    await using acp = await startWire({
      fetch: (request) =>
        request.path === "/api/session/ses_loaded/message" ? new Response(null, { status: 500 }) : undefined,
    })
    acp.server.sessions.set("ses_loaded", makeSession("ses_loaded"))
    await acp.initialize()

    expect(
      await rpcError(acp.request("session/load", { cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] })),
    ).toMatchObject({ code: -32603 })
    expect(
      await rpcError(
        acp.request("session/set_config_option", { sessionId: "ses_loaded", configId: "mode", value: "plan" }),
      ),
    ).toMatchObject({ code: -32602, data: { sessionId: "ses_loaded" } })
  })

  test("fails new and resume before attaching when the catalog does not decode", async () => {
    // The client rejects a model without a name, so the catalog fails to load.
    await using acp = await startWire({
      fetch: (request) =>
        request.path === "/api/model"
          ? Response.json({
              location: { directory: "/workspace", project: { id: "global", directory: "/workspace" } },
              data: [testModel, { ...secondModel, name: null }],
            })
          : undefined,
    })
    acp.server.sessions.set("ses_resumed", makeSession("ses_resumed"))
    await acp.initialize()
    const existing = new Set(acp.server.sessions.keys())

    expect(await rpcError(acp.newSession())).toMatchObject({ code: -32603, data: { errorName: "ClientError" } })
    expect(new Set(acp.server.sessions.keys())).toEqual(existing)

    expect(
      await rpcError(acp.request("session/resume", { cwd: "/workspace", sessionId: "ses_resumed", mcpServers: [] })),
    ).toMatchObject({ code: -32603, data: { errorName: "ClientError" } })
    expect(
      await rpcError(
        acp.request("session/set_config_option", { sessionId: "ses_resumed", configId: "mode", value: "plan" }),
      ),
    ).toMatchObject({ code: -32602, data: { sessionId: "ses_resumed" } })
    expect(acp.updates).toEqual([])
  })

  test("lists server-backed pages for the requested cwd", async () => {
    await using acp = await startWire()
    Array.from({ length: 101 }, (_, index) =>
      makeSession(`ses_${index}`, { time: { created: index, updated: 1_000 + index } }),
    ).forEach((session) => acp.server.sessions.set(session.id, session))
    acp.server.sessions.set(
      "ses_other",
      makeSession("ses_other", { cwd: "/other", time: { created: 0, updated: 9_999 } }),
    )
    await acp.initialize()

    const first = await acp.request("session/list", { cwd: "/workspace" })
    const second = await acp.request("session/list", { cwd: "/workspace", cursor: first.nextCursor })

    expect(first.sessions).toHaveLength(100)
    expect(first.sessions[0]).toEqual({
      sessionId: "ses_100",
      cwd: "/workspace",
      title: "Session ses_100",
      updatedAt: new Date(1_100).toISOString(),
    })
    expect(first.nextCursor).toBeDefined()
    expect(second.sessions.map((session) => session.sessionId)).toEqual(["ses_0"])
    expect(second.nextCursor).toBeUndefined()
  })

  test("cancel keeps an idle session attached while close detaches it", async () => {
    await using acp = await startSession()

    await acp.notify("session/cancel", { sessionId: acp.sessionId })
    expect((await acp.prompt(acp.sessionId, "after cancel")).stopReason).toBe("end_turn")

    expect(await acp.request("session/close", { sessionId: acp.sessionId })).toEqual({})
    expect(await rpcError(acp.prompt(acp.sessionId, "after close"))).toMatchObject({
      code: -32602,
      data: { sessionId: acp.sessionId },
    })
    expect(await acp.request("session/close", { sessionId: "missing" })).toEqual({})
  })

  test("deletes sessions from backing and local storage", async () => {
    await using acp = await startSession()

    expect(await acp.request("session/delete", { sessionId: acp.sessionId })).toEqual({})
    expect(acp.server.sessions.has(acp.sessionId)).toBe(false)
    expect(await acp.request("session/delete", { sessionId: acp.sessionId })).toEqual({})
    expect(await acp.request("session/delete", { sessionId: "ses_never_created" })).toEqual({})
    expect(await acp.request("session/delete", { sessionId: "never-created" })).toEqual({})
    expect(
      await rpcError(
        acp.request("session/set_config_option", { sessionId: acp.sessionId, configId: "effort", value: "high" }),
      ),
    ).toMatchObject({ code: -32602, data: { sessionId: acp.sessionId } })
  })

  test("rejects malformed session IDs as invalid params", async () => {
    await using acp = await startWire()
    await acp.initialize()
    const params = { cwd: "/workspace", sessionId: "never-created", mcpServers: [] }

    const invalid = { code: -32602, message: "Invalid params: Invalid session ID", data: { field: "sessionID" } }

    expect(await rpcError(acp.request("session/load", params))).toEqual(invalid)
    expect(await rpcError(acp.request("session/resume", params))).toEqual(invalid)
    expect(await rpcError(acp.request("session/fork", params))).toEqual(invalid)
    expect(acp.server.requests.filter((request) => request.path.includes("never-created"))).toEqual([])
    expect(acp.logs).toEqual([])
  })

  test("rejects MCP-over-ACP servers before creating or loading a session", async () => {
    await using acp = await startWire()
    acp.server.sessions.set("ses_saved", makeSession("ses_saved"))
    await acp.initialize()
    const existing = new Set(acp.server.sessions.keys())
    const mcpServers: McpServer[] = [{ type: "acp", name: "client", serverId: "mcp_client" }]
    const invalid = {
      code: -32602,
      message: "Invalid params: MCP-over-ACP is not supported",
      data: { field: "mcpServers" },
    }

    expect(await rpcError(acp.newSession("/workspace", mcpServers))).toEqual(invalid)
    expect(
      await rpcError(acp.request("session/load", { cwd: "/workspace", sessionId: "ses_saved", mcpServers })),
    ).toEqual(invalid)
    expect(new Set(acp.server.sessions.keys())).toEqual(existing)
    expect(acp.server.requests.filter((request) => request.path.includes("ses_saved"))).toEqual([])
    expect(acp.logs).toEqual([])
  })

  test("rejects forking an unknown session as session not found", async () => {
    await using acp = await startWire()
    await acp.initialize()

    expect(
      await rpcError(acp.request("session/fork", { cwd: "/workspace", sessionId: "ses_unknown", mcpServers: [] })),
    ).toEqual({
      code: -32602,
      message: "Invalid params: session not found: ses_unknown",
      data: { sessionId: "ses_unknown" },
    })
    expect(acp.logs).toEqual([])
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
    await acp.newSession("/workspace", [local])

    const localConfig = (args: string[]) => ({
      name: "tools",
      directory: "/workspace",
      config: { type: "local", command: ["bun", ...args], environment: { TOKEN: "x" } },
    })
    expect(acp.server.mcp).toHaveLength(4)
    expect(acp.server.mcp.filter((item) => item.name === "tools")).toEqual([
      localConfig(["server.ts"]),
      localConfig(["changed.ts"]),
      localConfig(["server.ts"]),
    ])
    expect(acp.server.mcp.find((item) => item.name === "docs")).toEqual({
      name: "docs",
      directory: "/workspace",
      config: { type: "remote", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" }, oauth: false },
    })
  })
  test("leaves a session detached when re-attaching it fails", async () => {
    const broken: McpServer = { name: "broken", command: "bun", args: [], env: [] }
    await using acp = await startWire({
      fetch: (request) =>
        request.method === "PUT" && request.path === "/api/experimental/mcp/broken"
          ? new Response(null, { status: 500 })
          : undefined,
    })
    await acp.initialize()
    const failed = await acp.newSession()
    const other = await acp.newSession()
    await acp.until(() => acp.updates.filter(isCommands).length === 2, "initial commands")

    expect(
      await rpcError(
        acp.request("session/resume", { cwd: "/workspace", sessionId: failed.sessionId, mcpServers: [broken] }),
      ),
    ).toMatchObject({ code: -32603 })
    const since = acp.updates.length
    acp.server.catalog.models = [testModel]
    acp.server.send(ephemeralEvent("model.updated", {}))
    await acp.until(() => acp.updates.length > since, "config options for the attached session")

    expect(acp.updates.slice(since).map((item) => item.sessionId)).toEqual([other.sessionId])
    expect(
      await rpcError(
        acp.request("session/set_config_option", { sessionId: failed.sessionId, configId: "mode", value: "plan" }),
      ),
    ).toMatchObject({ code: -32602, data: { sessionId: failed.sessionId } })
  })
})

const isSessionUpdate = Schema.is(
  Schema.Struct({
    method: Schema.Literal("session/update"),
    params: Schema.Struct({ update: Schema.Struct({ sessionUpdate: Schema.String }) }),
  }),
)

function isCommands(item: SessionNotification) {
  return item.update.sessionUpdate === "available_commands_update"
}

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

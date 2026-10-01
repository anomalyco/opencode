import { describe, expect, test } from "bun:test"
import type { McpServer } from "@agentclientprotocol/sdk"
import { currentValue } from "./select-options"
import { ephemeralEvent, makeSession, rpcError, secondModel, startSession, startWire, testModel } from "./wire-fixture"

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
        sessionCapabilities: { close: {}, delete: {}, fork: {}, list: {}, resume: {} },
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

  test("loads and forks with paginated replay while resume does not replay", async () => {
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
    expect(replayed(forked.sessionId)).toEqual(history.map((message) => message.id))
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

    expect(await rpcError(acp.request("session/load", params))).toEqual({
      code: -32602,
      message: 'Invalid params: Expected a string starting with "ses"',
      data: {},
    })
    expect(await rpcError(acp.request("session/fork", params))).toEqual({
      code: -32602,
      message: "Invalid params: Invalid session ID",
      data: { field: "sessionID" },
    })
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

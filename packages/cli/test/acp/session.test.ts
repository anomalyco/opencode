import { describe, expect, test } from "bun:test"
import type { McpServer } from "@agentclientprotocol/sdk"
import { currentValue, makeSession, rpcError, secondModel, startWire, type ServerRequest } from "./wire-fixture"

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
    expect(await rpcError(acp.request("authenticate", { methodId: "missing" }))).toEqual({
      code: -32602,
      message: "Invalid params: unknown auth method: missing",
      data: { methodId: "missing" },
    })
  })

  test("creates a v2 session, registers mcp, and publishes commands", async () => {
    await using acp = await startWire({ commands: [{ name: "review" }] })
    await acp.initialize({ childSessionUpdates: true })

    const result = await acp.newSession("/workspace", [
      { name: "docs", command: "bun", args: ["docs.ts"], env: [{ name: "TOKEN", value: "x" }] },
    ])

    expect(result.sessionId).toBe("ses_1")
    expect(result.configOptions?.map((option) => option.id)).toEqual(["model", "effort", "mode"])
    expect(acp.server.requests).toContainEqual({
      method: "PUT",
      path: "/api/experimental/mcp/docs",
      query: { "location[directory]": "/workspace" },
      body: { config: { type: "local", command: ["bun", "docs.ts"], environment: { TOKEN: "x" } } },
    })
    expect(acp.updates.at(-1)).toEqual({
      sessionId: "ses_1",
      update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "" }] },
    })
  })

  test("does not persist the first catalog variant when no explicit default exists", async () => {
    const model = { ...secondModel, variants: [{ id: "none" }, { id: "high" }] }
    await using acp = await startWire({
      models: [model],
      defaultModel: model,
      fetch(request, server) {
        if (request.method !== "POST" || request.path !== "/api/session") return undefined
        const session = makeSession("ses_default_variant", { model: { providerID: model.providerID, id: model.id } })
        server.sessions.set(session.id, session)
        return Response.json({ data: session })
      },
    })
    await acp.initialize()

    const created = await acp.newSession()

    expect(acp.server.requests).toContainEqual({
      method: "POST",
      path: "/api/session",
      query: {},
      body: { location: { directory: "/workspace" } },
    })
    expect(currentValue(created, "effort")).toBe("default")
  })

  test("loads and forks with paginated replay while resume does not replay", async () => {
    await using acp = await startWire({
      fetch(request) {
        if (request.method !== "GET" || request.path !== "/api/session/ses_loaded/message") return undefined
        if (request.query.cursor === "messages-2") {
          return Response.json({
            data: [{ id: "msg_assistant", type: "assistant", content: [{ type: "text", text: "hi there" }] }],
            cursor: {},
          })
        }
        return Response.json({
          data: [{ id: "msg_user", type: "user", text: "hello", time: { created: 1 } }],
          cursor: { next: "messages-2" },
        })
      },
    })
    acp.server.sessions.set(
      "ses_loaded",
      makeSession("ses_loaded", {
        agent: "plan",
        model: { providerID: "test", id: secondModel.id, variant: "medium" },
      }),
    )
    acp.server.sessions.set(
      "ses_resume",
      makeSession("ses_resume", { agent: "plan", model: { providerID: "test", id: secondModel.id, variant: "low" } }),
    )
    acp.server.messages.set("ses_resume", [{ id: "msg_resume", type: "user", text: "hidden", time: { created: 1 } }])
    await acp.initialize()

    const loaded = await acp.request("session/load", { cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] })
    const resumed = await acp.request("session/resume", { cwd: "/workspace", sessionId: "ses_resume", mcpServers: [] })
    acp.server.messages.set("ses_loaded", [{ id: "msg_fork", type: "user", text: "forked", time: { created: 2 } }])
    const forked = await acp.request("session/fork", { cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] })
    const mismatched = await rpcError(
      acp.request("session/load", { cwd: "/elsewhere", sessionId: "ses_loaded", mcpServers: [] }),
    )
    const missing = await rpcError(
      acp.request("session/load", { cwd: "/workspace", sessionId: "ses_missing", mcpServers: [] }),
    )

    expect(mismatched).toEqual({
      code: -32602,
      message: "Invalid params: session ses_loaded does not belong to cwd: /elsewhere",
      data: { sessionId: "ses_loaded", cwd: "/elsewhere" },
    })
    expect(missing).toMatchObject({ code: -32602, message: "Invalid params: session not found: ses_missing" })
    expect(currentValue(loaded, "model")).toBe("test/second-model")
    expect(currentValue(loaded, "effort")).toBe("medium")
    expect(currentValue(loaded, "mode")).toBe("plan")
    expect(currentValue(resumed, "effort")).toBe("low")
    expect(forked.sessionId).toBe("ses_1")
    expect(currentValue(forked, "effort")).toBe("medium")
    expect(
      acp.updates.filter(
        (item) =>
          item.update.sessionUpdate === "user_message_chunk" || item.update.sessionUpdate === "agent_message_chunk",
      ),
    ).toEqual([
      {
        sessionId: "ses_loaded",
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: "msg_user",
          content: { type: "text", text: "hello" },
        },
      },
      {
        sessionId: "ses_loaded",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg_assistant",
          content: { type: "text", text: "hi there" },
        },
      },
      {
        sessionId: "ses_1",
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: "msg_fork",
          content: { type: "text", text: "forked" },
        },
      },
    ])
    expect(
      acp.server.requests
        .filter((request) => request.path.endsWith("/message"))
        .map((request) => ({ path: request.path, query: request.query })),
    ).toEqual([
      { path: "/api/session/ses_loaded/message", query: { limit: "200", order: "asc" } },
      { path: "/api/session/ses_loaded/message", query: { limit: "200", cursor: "messages-2" } },
      { path: "/api/session/ses_1/message", query: { limit: "200", order: "asc" } },
    ])
    expect(acp.server.requests).toContainEqual({
      method: "POST",
      path: "/api/session/ses_loaded/fork",
      query: {},
      body: {},
    })
  })

  test("lists server-backed pages and forwards cwd and cursor", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      makeSession(`ses_${100 - index}`, {
        time: { created: index, updated: 100_000 - index },
        title: `Session ${100 - index}`,
      }),
    )
    await using acp = await startWire({
      fetch(request) {
        if (request.method !== "GET" || request.path !== "/api/session") return undefined
        if (request.query.cursor === "page-2") {
          return Response.json({ data: [makeSession("ses_0", { time: { created: 0, updated: 1 } })], cursor: {} })
        }
        return Response.json({ data: firstPage, cursor: { next: "page-2" } })
      },
    })
    await acp.initialize()

    const first = await acp.request("session/list", { cwd: "/workspace" })
    const second = await acp.request("session/list", { cwd: "/workspace", cursor: first.nextCursor })

    expect(first.sessions).toHaveLength(100)
    expect(first.sessions[0]).toEqual({
      sessionId: "ses_100",
      cwd: "/workspace",
      title: "Session 100",
      updatedAt: new Date(100_000).toISOString(),
    })
    expect(first.nextCursor).toBe("page-2")
    expect(second.sessions.map((session) => session.sessionId)).toEqual(["ses_0"])
    expect(second.nextCursor).toBeUndefined()
    expect(
      acp.server.requests.filter((request) => request.path === "/api/session").map((request) => request.query),
    ).toEqual([
      { limit: "100", order: "desc", directory: "/workspace" },
      { limit: "100", order: "desc", directory: "/workspace", cursor: "page-2" },
    ])
  })

  test("cancel preserves the attachment while close removes it and surfaces interrupt failures", async () => {
    const interrupt = { fail: true }
    await using acp = await startWire({
      fetch(request) {
        if (request.method !== "POST" || request.path !== "/api/session/ses_1/interrupt") return undefined
        return interrupt.fail ? new Response(null, { status: 500 }) : Response.json({ interrupted: false })
      },
    })
    await acp.initialize()
    const created = await acp.newSession()

    await acp.notify("session/cancel", { sessionId: created.sessionId })
    await acp.until(() => interrupts(acp.server.requests).length === 1, "cancel interrupt")
    const updated = await acp.request("session/set_config_option", {
      sessionId: created.sessionId,
      configId: "effort",
      value: "high",
    })
    expect(currentValue(updated, "effort")).toBe("high")

    expect(await rpcError(acp.request("session/close", { sessionId: created.sessionId }))).toMatchObject({
      code: -32603,
      message: "Internal error: Internal service failure",
      data: { errorName: "ClientError" },
    })
    interrupt.fail = false
    expect(await acp.request("session/close", { sessionId: created.sessionId })).toEqual({})
    expect(
      await rpcError(
        acp.request("session/set_config_option", {
          sessionId: created.sessionId,
          configId: "effort",
          value: "default",
        }),
      ),
    ).toEqual({
      code: -32602,
      message: `Invalid params: session not found: ${created.sessionId}`,
      data: { sessionId: created.sessionId },
    })
    expect(await acp.request("session/close", { sessionId: "missing" })).toEqual({})
    expect(interrupts(acp.server.requests)).toEqual([
      "/api/session/ses_1/interrupt",
      "/api/session/ses_1/interrupt",
      "/api/session/ses_1/interrupt",
      "/api/session/missing/interrupt",
    ])
  })

  test("deletes sessions from backing and local storage", async () => {
    await using acp = await startWire()
    await acp.initialize()
    const session = await acp.newSession()

    expect(await acp.request("session/delete", { sessionId: session.sessionId })).toEqual({})
    expect(await acp.request("session/delete", { sessionId: session.sessionId })).toEqual({})
    expect(acp.server.requests.filter((request) => request.method === "DELETE")).toEqual([
      { method: "DELETE", path: "/api/session/ses_1", query: {}, body: undefined },
      { method: "DELETE", path: "/api/session/ses_1", query: {}, body: undefined },
    ])
    expect(
      await rpcError(
        acp.request("session/set_config_option", { sessionId: session.sessionId, configId: "effort", value: "high" }),
      ),
    ).toMatchObject({ code: -32602, data: { sessionId: session.sessionId } })
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
    const mcp = "/api/experimental/mcp/"
    await using acp = await startWire()
    await acp.initialize()

    await acp.newSession("/workspace", [local, local, remote])
    await acp.request("session/resume", { cwd: "/workspace", sessionId: "ses_1", mcpServers: [local, remote] })
    await acp.request("session/resume", { cwd: "/workspace", sessionId: "ses_1", mcpServers: [changed] })
    await acp.newSession("/workspace", [local])

    const adds = acp.server.requests.filter((request) => request.method === "PUT" && request.path.startsWith(mcp))
    const localConfig = (args: string[]) => ({
      config: { type: "local", command: ["bun", ...args], environment: { TOKEN: "x" } },
    })
    expect(adds).toHaveLength(4)
    expect(adds.filter((request) => request.path === `${mcp}tools`).map((request) => request.body)).toEqual([
      localConfig(["server.ts"]),
      localConfig(["changed.ts"]),
      localConfig(["server.ts"]),
    ])
    expect(adds.find((request) => request.path === `${mcp}docs`)?.body).toEqual({
      config: { type: "remote", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" }, oauth: false },
    })
    expect(adds.map((request) => request.query)).toEqual(
      Array.from({ length: 4 }, () => ({ "location[directory]": "/workspace" })),
    )
  })
})

function interrupts(requests: readonly ServerRequest[]) {
  return requests.filter((request) => request.path.endsWith("/interrupt")).map((request) => request.path)
}

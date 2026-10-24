import { describe, expect, test } from "bun:test"
import { currentValue } from "./select-options"
import { makeSession, rpcError, secondModel, startWire } from "./wire-fixture"

describe("acp catalog and config options over the wire", () => {
  test("switches model, effort, and mode against the warm catalog", async () => {
    await using acp = await startWire()
    acp.server.catalog.models.push({ ...secondModel, providerID: "test/sub" })
    await acp.initialize()
    const sessionId = (await acp.newSession()).sessionId
    const set = (configId: string, value: string) =>
      acp.request("session/set_config_option", { sessionId, configId, value })

    const selectedModel = await set("model", "test/second-model")
    const selectedEffort = await set("effort", "medium")
    const selectedMode = await set("mode", "plan")
    await acp.request("session/set_mode", { sessionId, modeId: "build" })

    expect(currentValue(selectedModel, "model")).toBe("test/second-model")
    expect(currentValue(selectedModel, "effort")).toBe("default")
    expect(currentValue(selectedEffort, "effort")).toBe("medium")
    expect(currentValue(selectedMode, "mode")).toBe("plan")
    expect(acp.server.selections).toEqual([
      { sessionID: sessionId, model: { providerID: "test", id: secondModel.id } },
      { sessionID: sessionId, model: { providerID: "test", id: secondModel.id, variant: "medium" } },
      { sessionID: sessionId, agent: "plan" },
      { sessionID: sessionId, agent: "build" },
    ])

    expect(await rpcError(set("effort", "maximum"))).toMatchObject({ code: -32602, data: { effort: "maximum" } })
    expect(await rpcError(set("mode", "missing"))).toMatchObject({ code: -32602, data: { mode: "missing" } })
    expect(await rpcError(set("missing", "value"))).toMatchObject({ code: -32602, data: { configId: "missing" } })
    expect(await rpcError(set("model", "test/missing-model"))).toMatchObject({
      code: -32602,
      data: { modelId: "test/missing-model" },
    })
    const overlap = "test/sub/second-model"
    expect(currentValue(await set("model", overlap), "model")).toBe(overlap)
    expect(currentValue(await set("model", `${overlap}/low`), "effort")).toBe("low")
  })

  test("answers the first session after a cold location activates its plugins (#52729, #52472)", async () => {
    await using acp = await startWire()
    const plugins = acp.server.catalog.plugins.splice(0)
    acp.server.catalog.models.splice(1)
    await acp.initialize()
    const activated = Bun.sleep(200).then(() => {
      acp.server.catalog.plugins.push(...plugins)
      acp.server.catalog.models.push(secondModel)
    })

    const session = await acp.newSession()
    const selected = await acp.request("session/set_config_option", {
      sessionId: session.sessionId,
      configId: "model",
      value: "test/second-model",
    })
    await activated

    expect(session.configOptions).toContainEqual(
      expect.objectContaining({
        id: "model",
        options: [
          { value: "test/second-model", name: "test/Second Model" },
          { value: "test/test-model", name: "test/Test Model" },
        ],
      }),
    )
    expect(currentValue(selected, "model")).toBe("test/second-model")
  })
})

describe("ACP transient plugin activation failures", () => {
  for (const method of ["session/new", "session/load", "session/resume"] as const) {
    test(`${method} retries a catalog read while plugins are still activating`, async () => {
      let reads = 0
      let checks = 0
      await using acp = await startWire({
        fetch(request) {
          if (request.path === "/api/plugin" && ++checks === 2) {
            return Response.json({
              location: { directory: "/workspace", project: { id: "global", directory: "/workspace" } },
              data: [],
            })
          }
          if (request.path !== "/api/model" || ++reads !== 1) return
          return Response.json(
            {
              _tag: "ServiceUnavailableError",
              service: "plugin",
              message: "Location plugins did not finish activating",
            },
            { status: 503 },
          )
        },
      })
      acp.server.sessions.set("ses_cold", makeSession("ses_cold"))
      await acp.initialize()
      const response =
        method === "session/new"
          ? await acp.newSession()
          : await acp.request(method, { cwd: "/workspace", sessionId: "ses_cold", mcpServers: [] })
      expect(response.configOptions).toContainEqual(expect.objectContaining({ id: "model" }))
      expect(reads).toBe(2)
      expect(checks).toBe(3)
    })
  }

  for (const service of ["database", undefined]) {
    test(`does not retry unavailable ${service ?? "unspecified"} services`, async () => {
      let reads = 0
      await using acp = await startWire({
        fetch(request) {
          if (request.path !== "/api/model") return
          reads++
          return Response.json({ _tag: "ServiceUnavailableError", service, message: "unavailable" }, { status: 503 })
        },
      })
      await acp.initialize()
      expect(await rpcError(acp.newSession())).toMatchObject({
        code: -32603,
        data: { errorName: "ServiceUnavailableError" },
      })
      expect(reads).toBe(1)
      expect(acp.server.sessions.size).toBe(0)
    })
  }

  test("reports retryable activation exhaustion and can resume the same session later", async () => {
    let activating = true
    await using acp = await startWire({
      fetch(request) {
        if (request.path !== "/api/model" || !activating) return
        return Response.json(
          { _tag: "ServiceUnavailableError", service: "plugin", message: "Location plugins did not finish activating" },
          { status: 503 },
        )
      },
    })
    const session = makeSession("ses_pending")
    acp.server.sessions.set(session.id, session)
    await acp.initialize()
    const params = { cwd: "/workspace", sessionId: session.id, mcpServers: [] }
    expect(await rpcError(acp.request("session/resume", params))).toEqual({
      code: -32603,
      message: "Internal error: Location plugins are still activating; retry this request",
      data: { errorName: "CatalogNotReady", service: "plugin", retryable: true },
    })
    expect(acp.server.sessions.get(session.id)).toEqual(session)
    activating = false
    expect(await acp.request("session/resume", params)).toHaveProperty("configOptions")
    expect(acp.server.sessions.size).toBe(1)
  }, 10000)

  test("closing ACP cancels a catalog load that is retrying activation", async () => {
    let reads = 0
    const acp = await startWire({
      fetch(request) {
        if (request.path !== "/api/model") return
        reads++
        return Response.json(
          {
            _tag: "ServiceUnavailableError",
            service: "plugin",
            message: "Location plugins did not finish activating",
          },
          { status: 503 },
        )
      },
    })
    try {
      await acp.initialize()
      const pending = acp.newSession().then(
        () => "completed",
        () => "cancelled",
      )
      await acp.until(() => reads >= 2, "activation retry")
      await acp[Symbol.asyncDispose]()
      expect(await pending).toBe("cancelled")
    } finally {
      await acp[Symbol.asyncDispose]()
    }
  })
})

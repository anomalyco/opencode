import { describe, expect, test } from "bun:test"
import { currentValue } from "./select-options"
import { durableEvent, rpcError, secondModel, startSession, startWire } from "./wire-fixture"

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

  test("keeps the previous selection when a model or agent switch fails (#59789)", async () => {
    const failing = new Set<string>()
    await using acp = await startSession({
      fetch: (request) => {
        const kind = request.path.split("/").at(-1) ?? ""
        if (request.method !== "POST" || !failing.delete(kind)) return undefined
        return Response.json({ _tag: "ServiceUnavailableError", message: "unavailable" }, { status: 503 })
      },
    })
    const set = (configId: string, value: string) =>
      acp.request("session/set_config_option", { sessionId: acp.sessionId, configId, value })
    await set("effort", "high")
    failing.add("model").add("agent")

    await rpcError(set("model", "test/second-model"))
    await rpcError(set("mode", "plan"))
    const selected = await set("effort", "high")

    expect(currentValue(selected, "model")).toBe("test/test-model")
    expect(currentValue(selected, "effort")).toBe("high")
    expect(currentValue(selected, "mode")).toBe("build")
  })

  test("answers with the newest selection when an earlier switch's echo lands late (#60316)", async () => {
    await using acp = await startSession()
    const sessionID = acp.sessionId
    const set = (configId: string, value: string) =>
      acp.request("session/set_config_option", { sessionId: sessionID, configId, value })
    const echo = (id: string, variant?: string) =>
      durableEvent("session.model.selected", {
        sessionID,
        model: { providerID: "test", id, ...(variant ? { variant } : {}) },
      })

    await set("model", "test/second-model")
    await set("model", "test/test-model")
    acp.server.send(
      echo("second-model"),
      // Selection and title events share one stream, so the title arriving means the echo was seen.
      durableEvent("session.renamed", { sessionID, title: "seen" }),
    )
    await acp.waitForUpdate((item) => item.update.sessionUpdate === "session_info_update")
    const selected = await set("effort", "high")

    expect(currentValue(selected, "model")).toBe("test/test-model")
    expect(currentValue(selected, "effort")).toBe("high")
    expect(acp.updates.filter((item) => item.update.sessionUpdate === "config_option_update")).toEqual([])

    // Once its own switches are echoed, another client's switch still reaches this one.
    acp.server.send(echo("test-model"), echo("test-model", "high"), echo("second-model"))
    const update = await acp.waitForUpdate((item) => item.update.sessionUpdate === "config_option_update")
    expect(
      currentValue(update.update.sessionUpdate === "config_option_update" ? update.update : undefined, "model"),
    ).toBe("test/second-model")
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
          { value: "test/second-model", name: "Test Provider / Second Model" },
          { value: "test/test-model", name: "Test Provider / Test Model" },
        ],
      }),
    )
    expect(currentValue(selected, "model")).toBe("test/second-model")
  })
})

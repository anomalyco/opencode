import { describe, expect, test } from "bun:test"
import type { SessionConfigOption, SessionNotification } from "@agentclientprotocol/sdk"
import { flattenSelectOptions, requireSelectOption } from "./subprocess"
import {
  buildAgent,
  currentValue,
  makeSession,
  planAgent,
  reviewCommand,
  rpcError,
  secondModel,
  startWire,
  testModel,
} from "./wire-fixture"

describe("acp catalog and config options over the wire", () => {
  test("creates sessions from a catalog shared by concurrent callers in the same cwd", async () => {
    await using acp = await startWire()
    await acp.initialize()

    const first = await Promise.all([acp.newSession("/workspace"), acp.newSession("/workspace")])
    const other = await acp.newSession("/other")

    expect(first.map((session) => session.sessionId).toSorted()).toEqual(["ses_1", "ses_2"])
    expect(other.sessionId).toBe("ses_3")
    expect(currentValue(first[0], "model")).toBe("test/test-model")
    expect(currentValue(first[0], "mode")).toBe("build")
    expect(
      ["/api/model", "/api/model/default", "/api/agent", "/api/command"].map((path) =>
        acp.server.requests
          .filter((request) => request.path === path)
          .map((request) => request.query["location[directory]"]),
      ),
    ).toEqual(Array.from({ length: 4 }, () => ["/workspace", "/other"]))
    expect(
      acp.server.requests
        .filter((request) => request.method === "POST" && request.path === "/api/session")
        .map((request) => request.body),
    ).toEqual([
      { location: { directory: "/workspace" } },
      { location: { directory: "/workspace" } },
      { location: { directory: "/other" } },
    ])
    expect(acp.updates.map((item) => commandNames(item))).toEqual([["review"], ["review"], ["review"]])
  })

  test("follows server defaults and refreshes the catalog when location plugins finish activating", async () => {
    const configured = { ...buildAgent, id: "copilot-build", name: "copilot-build" }
    const catalog = { agents: [buildAgent, planAgent], commands: [reviewCommand] }
    await using acp = await startWire({
      fetch(request, server) {
        const location = { directory: request.query["location[directory]"] ?? "/workspace" }
        if (request.path === "/api/agent") return Response.json({ location, data: catalog.agents })
        if (request.path === "/api/command") return Response.json({ location, data: catalog.commands })
        if (request.method !== "POST" || request.path !== "/api/session") return undefined
        const session = { ...makeSession(`ses_${server.sessions.size + 1}`), agent: undefined, model: undefined }
        server.sessions.set(session.id, session)
        return Response.json({ data: session })
      },
    })
    await acp.initialize()

    const first = await acp.newSession()
    expect(currentValue(first, "mode")).toBe("build")
    expect(currentValue(first, "model")).toBe("test/test-model")

    const reads = agentReads(acp.server.requests)
    acp.server.send({ id: "evt_other", created: 1, type: "agent.updated", location: { directory: "/other" }, data: {} })
    catalog.agents = [configured, buildAgent, planAgent]
    catalog.commands = [reviewCommand, { name: "ship", description: "Ship it" }]
    acp.server.send({
      id: "evt_agent",
      created: 2,
      type: "agent.updated",
      location: { directory: "/workspace" },
      data: {},
    })

    const update = await acp.waitForUpdate(
      (item) => item.sessionId === first.sessionId && item.update.sessionUpdate === "config_option_update",
    )
    expect(update.update.sessionUpdate === "config_option_update" && modeOption(update.update.configOptions)).toEqual({
      currentValue: "copilot-build",
      options: ["copilot-build", "build", "plan"],
    })
    const commands = await acp.waitForUpdate(
      (item) => item.sessionId === first.sessionId && commandNames(item)?.length === 2,
    )
    expect(commandNames(commands)).toEqual(["review", "ship"])
    expect(agentReads(acp.server.requests)).toBe(reads + 1)

    const second = await acp.newSession()
    expect(currentValue(second, "mode")).toBe("copilot-build")
    expect(
      acp.server.requests
        .filter((request) => request.method === "POST" && request.path === "/api/session")
        .map((request) => request.body),
    ).toEqual([{ location: { directory: "/workspace" } }, { location: { directory: "/workspace" } }])
  })

  test("pushes config options on model.updated and commands on command.updated", async () => {
    const catalog = { models: [testModel], commands: [reviewCommand] }
    await using acp = await startWire({
      defaultModel: testModel,
      fetch(request) {
        const location = { directory: request.query["location[directory]"] ?? "/workspace" }
        if (request.path === "/api/model") return Response.json({ location, data: catalog.models })
        if (request.path === "/api/command") return Response.json({ location, data: catalog.commands })
        return undefined
      },
    })
    await acp.initialize()
    const session = await acp.newSession()
    expect(modelChoices(session.configOptions)).toEqual(["test/test-model"])

    catalog.models = [testModel, secondModel]
    acp.server.send({ id: "evt_model", created: 1, type: "model.updated", data: {} })
    const options = await acp.waitForUpdate((item) => item.update.sessionUpdate === "config_option_update")
    expect(
      options.update.sessionUpdate === "config_option_update" && modelChoices(options.update.configOptions),
    ).toEqual(["test/second-model", "test/test-model"])
    expect(acp.updates.filter((item) => item.update.sessionUpdate === "available_commands_update")).toHaveLength(1)

    catalog.commands = [reviewCommand, { name: "ship", description: "Ship it" }]
    acp.server.send({
      id: "evt_command",
      created: 2,
      type: "command.updated",
      location: { directory: "/workspace" },
      data: {},
    })
    const commands = await acp.waitForUpdate((item) => commandNames(item)?.length === 2)
    expect(commands).toEqual({
      sessionId: session.sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "review", description: "Review changes" },
          { name: "ship", description: "Ship it" },
        ],
      },
    })
    expect(acp.updates.filter((item) => item.update.sessionUpdate === "config_option_update")).toHaveLength(1)
  })

  test("reloads the catalog before rejecting a model or mode it has not seen", async () => {
    const configured = { ...planAgent, id: "copilot-build", name: "copilot-build" }
    const catalog = { models: [testModel], agents: [buildAgent, planAgent] }
    await using acp = await startWire({
      defaultModel: testModel,
      fetch(request) {
        const location = { directory: request.query["location[directory]"] ?? "/workspace" }
        if (request.path === "/api/model") return Response.json({ location, data: catalog.models })
        if (request.path === "/api/agent") return Response.json({ location, data: catalog.agents })
        return undefined
      },
    })
    await acp.initialize()
    const session = await acp.newSession()
    catalog.models = [testModel, secondModel]
    catalog.agents = [buildAgent, planAgent, configured]

    const model = await acp.request("session/set_config_option", {
      sessionId: session.sessionId,
      configId: "model",
      value: "test/second-model",
    })
    await acp.request("session/set_mode", { sessionId: session.sessionId, modeId: "copilot-build" })
    const missing = await rpcError(
      acp.request("session/set_config_option", { sessionId: session.sessionId, configId: "mode", value: "missing" }),
    )

    expect(currentValue(model, "model")).toBe("test/second-model")
    expect(
      acp.server.requests
        .filter((request) => request.path === `/api/session/${session.sessionId}/agent`)
        .map((request) => request.body),
    ).toEqual([{ agent: "copilot-build" }])
    expect(missing).toEqual({
      code: -32602,
      message: "Invalid params: mode not found: missing",
      data: { mode: "missing" },
    })
    expect(agentReads(acp.server.requests)).toBe(3)
  })

  test.each(["empty", "missing the default"])(
    "retries when the model list is %s but the default is ready",
    async (initial) => {
      await using acp = await startWire({
        fetch(request, server) {
          if (request.path !== "/api/model") return undefined
          if (server.requests.filter((item) => item.path === "/api/model").length !== 1) return undefined
          return Response.json({
            location: { directory: "/workspace", project: { id: "global", directory: "/workspace" } },
            data: initial === "empty" ? [] : [secondModel],
          })
        },
      })
      await acp.initialize()

      const session = await acp.newSession()
      const model = requireSelectOption(session.configOptions, "model")
      const choices = flattenSelectOptions(model).map((option) => option.value)

      expect(choices).toContain("test/second-model")
      expect(choices).toContain("test/test-model")
      expect(model.currentValue).toBe("test/test-model")
      expect(acp.server.requests.filter((request) => request.path === "/api/model")).toHaveLength(2)
    },
  )

  test("does not cache a failed catalog load", async () => {
    await using acp = await startWire({
      fetch(request, server) {
        if (request.path !== "/api/model") return undefined
        if (server.requests.filter((item) => item.path === "/api/model").length !== 1) return undefined
        return Response.json({ name: "ModelsNotReadyError", data: { message: "catalog is warming" } }, { status: 503 })
      },
    })
    await acp.initialize()

    const failure = await rpcError(acp.newSession())
    const retried = await acp.newSession()

    expect(failure).toMatchObject({ code: -32603, message: "Internal error: Internal service failure" })
    expect(retried.sessionId).toBe("ses_1")
    expect(acp.server.requests.filter((request) => request.path === "/api/model")).toHaveLength(2)
    expect(
      acp.server.requests.filter((request) => request.method === "POST" && request.path === "/api/session"),
    ).toHaveLength(1)
  })

  test("switches model, effort, and mode against the warm catalog", async () => {
    await using acp = await startWire()
    await acp.initialize()
    const session = await acp.newSession()

    const selectedModel = await acp.request("session/set_config_option", {
      sessionId: session.sessionId,
      configId: "model",
      value: "test/second-model",
    })
    const selectedEffort = await acp.request("session/set_config_option", {
      sessionId: session.sessionId,
      configId: "effort",
      value: "medium",
    })
    const selectedMode = await acp.request("session/set_config_option", {
      sessionId: session.sessionId,
      configId: "mode",
      value: "plan",
    })
    await acp.request("session/set_mode", { sessionId: session.sessionId, modeId: "build" })

    expect(currentValue(selectedModel, "model")).toBe("test/second-model")
    expect(currentValue(selectedModel, "effort")).toBe("default")
    expect(currentValue(selectedEffort, "effort")).toBe("medium")
    expect(currentValue(selectedMode, "mode")).toBe("plan")
    expect(
      acp.server.requests
        .filter((request) => request.path === `/api/session/${session.sessionId}/model`)
        .map((request) => request.body),
    ).toEqual([
      { model: { providerID: "test", id: secondModel.id } },
      { model: { providerID: "test", id: secondModel.id, variant: "medium" } },
    ])
    expect(
      acp.server.requests
        .filter((request) => request.path === `/api/session/${session.sessionId}/agent`)
        .map((request) => request.body),
    ).toEqual([{ agent: "plan" }, { agent: "build" }])
    expect(acp.server.requests.filter((request) => request.path === "/api/model")).toHaveLength(1)

    const set = (configId: string, value: string) =>
      rpcError(acp.request("session/set_config_option", { sessionId: session.sessionId, configId, value }))
    expect(await set("effort", "maximum")).toEqual({
      code: -32602,
      message: "Invalid params: effort not found: maximum",
      data: { effort: "maximum" },
    })
    expect(await set("mode", "missing")).toMatchObject({ code: -32602, data: { mode: "missing" } })
    expect(await set("missing", "value")).toEqual({
      code: -32602,
      message: "Invalid params: unknown config option: missing",
      data: { configId: "missing" },
    })
    expect(await set("model", "test/missing-model")).toMatchObject({
      code: -32602,
      message: "Invalid params: model not found: test/missing-model",
    })
  })

  test.todo(
    "advertises the built-in compact command (https://github.com/anomalyco/opencode/issues/37229)",
    async () => {
      await using acp = await startWire()
      await acp.initialize()
      const session = await acp.newSession()

      const commands = acp.updates.find((item) => item.sessionId === session.sessionId && commandNames(item))
      expect(commands && commandNames(commands)).toContain("compact")
    },
  )
})

function commandNames(item: SessionNotification) {
  if (item.update.sessionUpdate !== "available_commands_update") return undefined
  return item.update.availableCommands.map((command) => command.name)
}

function agentReads(requests: ReadonlyArray<{ readonly path: string }>) {
  return requests.filter((request) => request.path === "/api/agent").length
}

function modeOption(options: SessionConfigOption[]) {
  const mode = requireSelectOption(options, "mode")
  return { currentValue: mode.currentValue, options: flattenSelectOptions(mode).map((option) => option.value) }
}

function modelChoices(options: SessionConfigOption[] | null | undefined) {
  return flattenSelectOptions(requireSelectOption(options, "model")).map((option) => option.value)
}

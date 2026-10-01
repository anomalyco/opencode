import { describe, expect, test } from "bun:test"
import type { SessionConfigOption, SessionNotification } from "@agentclientprotocol/sdk"
import { currentValue, requireSelectOption, selectValues } from "./select-options"
import {
  buildAgent,
  ephemeralEvent,
  planAgent,
  reviewCommand,
  rpcError,
  secondModel,
  startSession,
  startWire,
  testModel,
  type Wire,
} from "./wire-fixture"

describe("acp catalog and config options over the wire", () => {
  test("creates sessions from a catalog shared by concurrent callers in the same cwd", async () => {
    await using acp = await startWire()
    await acp.initialize()

    const first = await Promise.all([acp.newSession("/workspace"), acp.newSession("/workspace")])
    const other = await acp.newSession("/other")

    expect(currentValue(first[0], "model")).toBe("test/test-model")
    expect(currentValue(first[0], "mode")).toBe("build")
    expect(
      (["model", "default", "agent", "command"] as const).map((kind) =>
        acp.server.catalogReads.filter((read) => read.kind === kind).map((read) => read.directory),
      ),
    ).toEqual(Array.from({ length: 4 }, () => ["/workspace", "/other"]))
    expect(
      Object.fromEntries([...acp.server.sessions.values()].map((session) => [session.id, session.location.directory])),
    ).toEqual({
      [first[0].sessionId]: "/workspace",
      [first[1].sessionId]: "/workspace",
      [other.sessionId]: "/other",
    })
    await acp.until(() => acp.updates.filter((item) => commandNames(item)).length === 3, "commands for each session")
    expect(acp.updates.map(commandNames)).toEqual(Array.from({ length: 3 }, () => ["review", "compact"]))
  })

  test("follows server defaults and refreshes the catalog when location plugins finish activating", async () => {
    const configured = { ...buildAgent, id: "copilot-build", name: "copilot-build" }
    await using acp = await startSession()
    expect(currentValue(acp.session, "mode")).toBe("build")
    expect(currentValue(acp.session, "model")).toBe("test/test-model")

    const reads = agentReads(acp)
    acp.server.send(ephemeralEvent("agent.updated", {}, { directory: "/other" }))
    acp.server.catalog.agents = [configured, buildAgent, planAgent]
    acp.server.catalog.commands = [reviewCommand, { name: "ship", description: "Ship it" }]
    acp.server.send(ephemeralEvent("agent.updated", {}, { directory: "/workspace" }))

    const update = await acp.waitForUpdate((item) => item.update.sessionUpdate === "config_option_update")
    expect(update.update.sessionUpdate === "config_option_update" && modeOption(update.update.configOptions)).toEqual({
      currentValue: "copilot-build",
      options: ["copilot-build", "build", "plan"],
    })
    const commands = await acp.waitForUpdate((item) => commandNames(item)?.length === 3)
    expect(commandNames(commands)).toEqual(["review", "ship", "compact"])
    expect(agentReads(acp)).toBe(reads + 1)

    const second = await acp.newSession()
    expect(currentValue(second, "mode")).toBe("copilot-build")
  })

  test("defaults the mode to the first selectable agent the server lists", async () => {
    const configured = { ...buildAgent, id: "review", name: "Review", mode: "all" as const }
    await using acp = await startWire()
    acp.server.catalog.agents = [configured, buildAgent, planAgent]
    await acp.initialize()

    const session = await acp.newSession()

    expect(modeOption(session.configOptions ?? [])).toEqual({
      currentValue: "review",
      options: ["review", "build", "plan"],
    })
  })

  test("pushes config options on model.updated and commands on command.updated", async () => {
    await using acp = await startWire()
    acp.server.catalog.models = [testModel]
    await acp.initialize()
    const session = await acp.newSession()
    expect(selectValues(session.configOptions, "model")).toEqual(["test/test-model"])

    acp.server.catalog.models = [testModel, secondModel]
    acp.server.send(ephemeralEvent("model.updated", {}))
    const options = await acp.waitForUpdate((item) => item.update.sessionUpdate === "config_option_update")
    expect(
      options.update.sessionUpdate === "config_option_update" && selectValues(options.update.configOptions, "model"),
    ).toEqual(["test/second-model", "test/test-model"])

    acp.server.catalog.commands = [reviewCommand, { name: "ship", description: "Ship it" }]
    acp.server.send(ephemeralEvent("command.updated", {}, { directory: "/workspace" }))
    const commands = await acp.waitForUpdate((item) => commandNames(item)?.length === 3)
    expect(commands).toEqual({
      sessionId: session.sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "review", description: "Review changes" },
          { name: "ship", description: "Ship it" },
          { name: "compact", description: "Compact the session" },
        ],
      },
    })
    expect(acp.updates.filter((item) => item.update.sessionUpdate === "config_option_update")).toHaveLength(1)
  })

  test("reloads the catalog before rejecting a model or mode it has not seen", async () => {
    const configured = { ...planAgent, id: "copilot-build", name: "copilot-build" }
    await using acp = await startWire()
    acp.server.catalog.models = [testModel]
    await acp.initialize()
    const session = await acp.newSession()
    acp.server.catalog.models = [testModel, secondModel]
    acp.server.catalog.agents = [buildAgent, planAgent, configured]
    const set = (configId: string, value: string) =>
      acp.request("session/set_config_option", { sessionId: session.sessionId, configId, value })
    const initialModelReads = modelReads(acp)

    const model = await set("model", "test/second-model")
    const reloadedModelReads = modelReads(acp)
    const missingModel = await rpcError(set("model", "test/missing-model"))
    const missingModelReads = modelReads(acp)
    await acp.request("session/set_mode", { sessionId: session.sessionId, modeId: "copilot-build" })
    const reads = agentReads(acp)
    const missing = await rpcError(set("mode", "missing"))

    expect(currentValue(model, "model")).toBe("test/second-model")
    expect([reloadedModelReads, missingModelReads]).toEqual([initialModelReads + 1, initialModelReads + 2])
    expect(missingModel).toMatchObject({ code: -32602, data: { modelId: "test/missing-model" } })
    expect(acp.server.selections).toContainEqual({ sessionID: session.sessionId, agent: "copilot-build" })
    expect(missing).toMatchObject({ code: -32602, data: { mode: "missing" } })
    expect(agentReads(acp)).toBeGreaterThan(reads)
  })

  test.each([
    [
      "a sibling session closes",
      async (acp: Wire) => {
        const closed = await acp.newSession()
        const open = await acp.newSession()
        await acp.request("session/close", { sessionId: closed.sessionId })
        return open.sessionId
      },
    ],
    ...(["session/load", "session/resume"] as const).map(
      (method) =>
        [
          `${method} re-attaches the session`,
          async (acp: Wire) => {
            const session = await acp.newSession()
            const params = { cwd: "/workspace", sessionId: session.sessionId, mcpServers: [] }
            await acp.request(method, params)
            await acp.request(method, params)
            return session.sessionId
          },
        ] as const,
    ),
  ])("pushes exactly one update per catalog change after %s", async (_, setup) => {
    await using acp = await startWire()
    acp.server.catalog.models = [testModel]
    await acp.initialize()
    const sessionId = await setup(acp)
    const since = acp.updates.length

    await change(acp, sessionId, "config_option_update", () => {
      acp.server.catalog.models = [testModel, secondModel]
      acp.server.send(ephemeralEvent("model.updated", {}))
    })
    await change(acp, sessionId, "available_commands_update", () => {
      acp.server.catalog.commands = [reviewCommand, { name: "ship", description: "Ship it" }]
      acp.server.send(ephemeralEvent("command.updated", {}, { directory: "/workspace" }))
    })

    expect(updateKinds(acp, since)).toEqual([
      [sessionId, "config_option_update"],
      [sessionId, "available_commands_update"],
    ])
  })

  test.each(["empty", "missing the default"])(
    "retries when the model list is %s but the default is ready",
    async (initial) => {
      await using acp = await startWire()
      acp.server.catalog.models = initial === "empty" ? [] : [secondModel]
      acp.server.catalog.defaultModel = testModel
      await acp.initialize()

      const created = acp.newSession()
      await acp.until(() => modelReads(acp) === 1, "first model read")
      acp.server.catalog.models = [testModel, secondModel]
      const session = await created

      const choices = selectValues(session.configOptions, "model")
      expect(choices).toContain("test/second-model")
      expect(choices).toContain("test/test-model")
      expect(currentValue(session, "model")).toBe("test/test-model")
      expect(modelReads(acp)).toBe(2)
    },
  )

  test("does not cache a failed catalog load", async () => {
    const failure = { pending: true }
    await using acp = await startWire({
      fetch(request) {
        if (request.path !== "/api/model" || !failure.pending) return undefined
        failure.pending = false
        return Response.json({ name: "ModelsNotReadyError", data: { message: "catalog is warming" } }, { status: 503 })
      },
    })
    await acp.initialize()

    expect(await rpcError(acp.newSession())).toMatchObject({ code: -32603 })
    expect(acp.server.sessions.size).toBe(0)
    const retried = await acp.newSession()

    expect(acp.server.sessions.has(retried.sessionId)).toBe(true)
    expect(modelReads(acp)).toBe(1)
  })

  test("switches model, effort, and mode against the warm catalog", async () => {
    await using acp = await startSession()
    const sessionId = acp.sessionId
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
    expect(modelReads(acp)).toBe(1)

    expect(await rpcError(set("effort", "maximum"))).toMatchObject({ code: -32602, data: { effort: "maximum" } })
    expect(await rpcError(set("mode", "missing"))).toMatchObject({ code: -32602, data: { mode: "missing" } })
    expect(await rpcError(set("missing", "value"))).toMatchObject({ code: -32602, data: { configId: "missing" } })
    expect(await rpcError(set("model", "test/missing-model"))).toMatchObject({
      code: -32602,
      data: { modelId: "test/missing-model" },
    })
  })

  test("advertises and runs the built-in compact over a server command (https://github.com/anomalyco/opencode/issues/37229)", async () => {
    await using acp = await startSession()
    const advertised = await acp.waitForUpdate((item) => commandNames(item) !== undefined)

    acp.server.catalog.commands = [
      reviewCommand,
      { name: "compact", description: "Server compact" },
      { name: "ship", description: "Ship it" },
    ]
    acp.server.send(ephemeralEvent("command.updated", {}, { directory: "/workspace" }))
    const replaced = await acp.waitForUpdate((item) => item !== advertised && commandNames(item) !== undefined)
    const compacted = await acp.prompt(acp.sessionId, "/compact")

    expect([advertised, replaced].map((item) => item.update)).toEqual([
      {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "review", description: "Review changes" },
          { name: "compact", description: "Compact the session" },
        ],
      },
      {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "review", description: "Review changes" },
          { name: "ship", description: "Ship it" },
          { name: "compact", description: "Compact the session" },
        ],
      },
    ])
    expect(compacted.stopReason).toBe("end_turn")
    expect(acp.server.submissions.map((item) => item.kind)).toEqual(["compact"])
  })
})

// Each change waits on a catalog reload over HTTP, so a stray update for an earlier change lands before the next one.
async function change(acp: Wire, sessionId: string, kind: string, trigger: () => void) {
  const seen = acp.updates.filter((item) => item.sessionId === sessionId && item.update.sessionUpdate === kind).length
  trigger()
  await acp.until(
    () =>
      acp.updates.filter((item) => item.sessionId === sessionId && item.update.sessionUpdate === kind).length > seen,
    kind,
  )
}

function updateKinds(acp: Wire, since: number) {
  return acp.updates.slice(since).map((item) => [item.sessionId, item.update.sessionUpdate])
}

function commandNames(item: SessionNotification) {
  if (item.update.sessionUpdate !== "available_commands_update") return undefined
  return item.update.availableCommands.map((command) => command.name)
}

function agentReads(acp: Wire) {
  return acp.server.catalogReads.filter((read) => read.kind === "agent").length
}

function modelReads(acp: Wire) {
  return acp.server.catalogReads.filter((read) => read.kind === "model").length
}

function modeOption(options: SessionConfigOption[]) {
  const mode = requireSelectOption(options, "mode")
  return { currentValue: mode.currentValue, options: selectValues(options, "mode") }
}

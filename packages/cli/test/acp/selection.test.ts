import { describe, expect, test } from "bun:test"
import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import { currentValue } from "./select-options"
import { durableEvent, secondModel, startSession, stepEnded, turn, type Wire } from "./wire-fixture"

describe("acp follows model and agent selections from other clients", () => {
  test("pushes an external model switch with its variant and uses it for the next prompt", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => turn(sessionID, id, stepEnded(sessionID, "msg_assistant")),
    })

    acp.server.send(
      durableEvent("session.model.selected", {
        sessionID: acp.sessionId,
        model: { providerID: "test", id: secondModel.id, variant: "low" },
        previous: { providerID: "test", id: "test-model" },
      }),
    )
    const [options] = await optionUpdates(acp, acp.sessionId, 1)
    await acp.prompt(acp.sessionId, "hello")

    expect(values(options)).toEqual({ model: "test/second-model", effort: "low", mode: "build" })
    expect(await acp.waitForUpdate((item) => item.update.sessionUpdate === "usage_update")).toMatchObject({
      update: { size: secondModel.limit.context },
    })
  })

  test("shows the default effort when the external switch carries no variant", async () => {
    await using acp = await startSession()
    await acp.request("session/set_config_option", { sessionId: acp.sessionId, configId: "effort", value: "high" })

    acp.server.send(
      durableEvent("session.model.selected", {
        sessionID: acp.sessionId,
        model: { providerID: "test", id: secondModel.id },
      }),
    )

    expect(values((await optionUpdates(acp, acp.sessionId, 1))[0])).toEqual({
      model: "test/second-model",
      effort: "default",
      mode: "build",
    })
  })

  test("pushes an external agent switch as the mode", async () => {
    await using acp = await startSession()

    acp.server.send(
      durableEvent("session.agent.selected", { sessionID: acp.sessionId, agent: "plan", previous: "build" }),
    )

    expect(values((await optionUpdates(acp, acp.sessionId, 1))[0])).toEqual({
      model: "test/test-model",
      effort: "default",
      mode: "plan",
    })
  })

  test("does not echo its own model and mode switches", async () => {
    await using acp = await startSession({
      // The server publishes the selection event before it answers the switch.
      fetch: (request) => {
        const sessionID = request.path.split("/")[3] ?? ""
        if (request.method !== "POST") return undefined
        if (request.path.endsWith("/model"))
          acp.server.send(
            durableEvent("session.model.selected", {
              sessionID,
              model: { providerID: "test", id: secondModel.id, variant: "medium" },
            }),
          )
        if (request.path.endsWith("/agent"))
          acp.server.send(durableEvent("session.agent.selected", { sessionID, agent: "plan" }))
        return undefined
      },
    })
    const set = (configId: string, value: string) =>
      acp.request("session/set_config_option", { sessionId: acp.sessionId, configId, value })

    await set("model", "test/second-model/medium")
    await acp.request("session/set_mode", { sessionId: acp.sessionId, modeId: "plan" })
    acp.server.send(durableEvent("session.agent.selected", { sessionID: acp.sessionId, agent: "build" }))
    const updates = await optionUpdates(acp, acp.sessionId, 1)

    expect(updates.map(values)).toEqual([{ model: "test/second-model", effort: "medium", mode: "build" }])
  })

  test("ignores selections for other sessions", async () => {
    await using acp = await startSession()
    const other = await acp.newSession()

    acp.server.send(durableEvent("session.agent.selected", { sessionID: "ses_unattached", agent: "plan" }))
    acp.server.send(durableEvent("session.agent.selected", { sessionID: other.sessionId, agent: "plan" }))
    acp.server.send(
      durableEvent("session.model.selected", {
        sessionID: acp.sessionId,
        model: { providerID: "test", id: secondModel.id },
      }),
    )
    const updates = await optionUpdates(acp, acp.sessionId, 1)

    expect(updates.map(values)).toEqual([{ model: "test/second-model", effort: "default", mode: "build" }])
  })

  test("stops following a closed session and follows it once after re-attaching", async () => {
    await using acp = await startSession()
    const other = await acp.newSession()
    await acp.request("session/close", { sessionId: acp.sessionId })

    acp.server.send(durableEvent("session.agent.selected", { sessionID: acp.sessionId, agent: "plan" }))
    acp.server.send(durableEvent("session.agent.selected", { sessionID: other.sessionId, agent: "plan" }))
    await optionUpdates(acp, other.sessionId, 1)
    expect(configUpdates(acp, acp.sessionId)).toEqual([])

    const stored = acp.server.sessions.get(acp.sessionId)
    if (stored) acp.server.sessions.set(acp.sessionId, { ...stored, agent: "plan" })
    const resume = () => acp.request("session/resume", { sessionId: acp.sessionId, cwd: "/workspace" })
    const resumed = await resume()
    await resume()
    acp.server.send(
      durableEvent("session.model.selected", {
        sessionID: acp.sessionId,
        model: { providerID: "test", id: secondModel.id },
      }),
    )
    const updates = await optionUpdates(acp, acp.sessionId, 1)

    expect(currentValue(resumed, "mode")).toBe("plan")
    expect(updates.map(values)).toEqual([{ model: "test/second-model", effort: "default", mode: "plan" }])
  })
})

function configUpdates(acp: Wire, sessionId: string) {
  return acp.updates.flatMap((item) =>
    item.sessionId === sessionId && item.update.sessionUpdate === "config_option_update"
      ? [item.update.configOptions]
      : [],
  )
}

function optionUpdates(acp: Wire, sessionId: string, count: number) {
  return acp.until(() => {
    const updates = configUpdates(acp, sessionId)
    return updates.length >= count && updates
  }, `${count} config_option_update for ${sessionId}`)
}

function values(options: SessionConfigOption[] | undefined) {
  return Object.fromEntries((options ?? []).map((option) => [option.id, option.currentValue]))
}

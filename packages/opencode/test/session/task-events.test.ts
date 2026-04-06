import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import { Session } from "../../src/session"
import { SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

const sessionID = SessionID.descending()
const parentID = SessionID.descending()
const modelID = ModelID.make("claude-3-5-sonnet")
const providerID = ProviderID.make("anthropic")

describe("subagent lifecycle events", () => {
  test("SubagentStarted schema validates correct payload", () => {
    const result = Session.Event.SubagentStarted.properties.safeParse({
      sessionID,
      parentID,
      agent: "general",
      description: "do a thing",
      model: { modelID, providerID },
      time: { start: Date.now() },
    })
    expect(result.success).toBe(true)
  })

  test("SubagentStopped schema validates completed payload", () => {
    const result = Session.Event.SubagentStopped.properties.safeParse({
      sessionID,
      parentID,
      agent: "general",
      description: "do a thing",
      model: { modelID, providerID },
      time: { start: Date.now() - 1000, end: Date.now() },
      tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 10, write: 5 } },
      cost: 0.002,
      status: "completed" as const,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe("completed")
      expect(result.data.error).toBeUndefined()
    }
  })

  test("SubagentStopped schema validates failed payload with error field", () => {
    const result = Session.Event.SubagentStopped.properties.safeParse({
      sessionID,
      parentID,
      agent: "general",
      description: "do a thing",
      model: { modelID, providerID },
      time: { start: Date.now() - 500, end: Date.now() },
      tokens: { input: 50, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
      status: "failed" as const,
      error: "context limit exceeded",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe("failed")
      expect(result.data.error).toBe("context limit exceeded")
    }
  })

  test("SubagentStopped schema rejects invalid status", () => {
    const result = Session.Event.SubagentStopped.properties.safeParse({
      sessionID,
      parentID,
      agent: "general",
      description: "test",
      model: { modelID: ModelID.make("m"), providerID: ProviderID.make("p") },
      time: { start: 0, end: 1 },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
      status: "error", // invalid — not in enum
    })
    expect(result.success).toBe(false)
  })

  test("Bus publish/subscribe round-trip for SubagentStarted", async () => {
    await using tmp = await tmpdir()
    const evts: Array<ReturnType<typeof Session.Event.SubagentStarted.properties.parse>> = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Bus.subscribe(Session.Event.SubagentStarted, (evt) => {
          evts.push(evt.properties)
        })
        await Bus.publish(Session.Event.SubagentStarted, {
          sessionID,
          parentID,
          agent: "general",
          description: "do a thing",
          model: { modelID, providerID },
          time: { start: Date.now() },
        })
        await Bun.sleep(10)
      },
    })

    expect(evts).toHaveLength(1)
    expect(evts[0].sessionID).toBe(sessionID)
    expect(evts[0].agent).toBe("general")
    expect(evts[0].description).toBe("do a thing")
    expect(evts[0].model.providerID).toBe(providerID)
  })

  test("Bus publish/subscribe round-trip for SubagentStopped", async () => {
    await using tmp = await tmpdir()
    const evts: Array<ReturnType<typeof Session.Event.SubagentStopped.properties.parse>> = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Bus.subscribe(Session.Event.SubagentStopped, (evt) => {
          evts.push(evt.properties)
        })
        const start = Date.now()
        await Bus.publish(Session.Event.SubagentStopped, {
          sessionID,
          parentID,
          agent: "general",
          description: "do a thing",
          model: { modelID, providerID },
          time: { start, end: start + 500 },
          tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.001,
          status: "completed",
        })
        await Bun.sleep(10)
      },
    })

    expect(evts).toHaveLength(1)
    expect(evts[0].status).toBe("completed")
    expect(evts[0].tokens.input).toBe(100)
    expect(evts[0].tokens.output).toBe(200)
    expect(evts[0].cost).toBe(0.001)
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { Bus } from "../../src/bus"
import { Session } from "../../src/session/session"
import { SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { WithInstance } from "../../src/project/with-instance"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
})

const sessionID = SessionID.descending()
const parentID = SessionID.descending()
const modelID = ModelID.make("claude-3-5-sonnet")
const providerID = ProviderID.make("anthropic")

const decodeStarted = Schema.decodeUnknownExit(Session.Event.SubagentStarted.properties)
const decodeStopped = Schema.decodeUnknownExit(Session.Event.SubagentStopped.properties)

describe("subagent lifecycle events", () => {
  test("SubagentStarted schema validates correct payload", () => {
    const result = decodeStarted({
      sessionID,
      parentID,
      agent: "general",
      description: "do a thing",
      model: { modelID, providerID },
      time: { start: Date.now() },
    })
    expect(Exit.isSuccess(result)).toBe(true)
  })

  test("SubagentStopped schema validates completed payload", () => {
    const result = decodeStopped({
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
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("completed")
      expect(result.value.error).toBeUndefined()
    }
  })

  test("SubagentStopped schema validates failed payload with error field", () => {
    const result = decodeStopped({
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
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("failed")
      expect(result.value.error).toBe("context limit exceeded")
    }
  })

  test("SubagentStopped schema rejects invalid status", () => {
    const result = decodeStopped({
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
    expect(Exit.isFailure(result)).toBe(true)
  })

  test("Bus publish/subscribe round-trip for SubagentStarted", async () => {
    await using tmp = await tmpdir()
    const evts: Array<Schema.Schema.Type<typeof Session.Event.SubagentStarted.properties>> = []

    await WithInstance.provide({
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
    const evts: Array<Schema.Schema.Type<typeof Session.Event.SubagentStopped.properties>> = []

    await WithInstance.provide({
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

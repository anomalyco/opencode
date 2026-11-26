import { describe, expect, test } from "bun:test"
import { ACPError } from "../../src/acp/error"
import {
  delivered,
  durableEvent,
  failed,
  rpcError,
  startSession,
  succeeded,
  textDelta,
  type Wire,
} from "./wire-fixture"

describe("acp errors", () => {
  test("wraps unknown defects without leaking raw details", () => {
    const requestError = ACPError.toRequestError(
      ACPError.fromUnknown(new Error("stack has sk-ant-secret and oauth refresh token")),
    )
    const serialized = JSON.stringify(requestError.toErrorResponse())

    expect(requestError.code).toBe(-32603)
    expect(requestError.message).toBe("Internal error: Internal service failure")
    expect(serialized).not.toContain("sk-ant-secret")
    expect(serialized).not.toContain("oauth refresh token")
    expect(serialized).not.toContain("stack")
  })
})

describe("acp error boundary over the wire", () => {
  test.each<[string, (acp: Wire) => void, string[]]>([
    ["ends", (acp) => acp.server.closeEvents(), []],
    [
      "drops its connection",
      (acp) => acp.server.dropEvents(),
      ["ACP catalog event stream failed", "ACP selection event stream failed"],
    ],
  ])(
    "reports an unavailable server when the event stream %s mid-turn and once the server stops",
    async (_, lose, logs) => {
      await using acp = await startSession({
        onPrompt: ({ sessionID, id }) => [delivered(sessionID, id), textDelta(sessionID, "msg_held", "working")],
      })
      const unavailable = {
        code: -32603,
        message: "Internal error: OpenCode server is unavailable",
        data: { errorName: "ServerUnavailable" },
      }

      const prompt = acp.prompt(acp.sessionId, "hold")
      await acp.waitForUpdate((item) => item.update.sessionUpdate === "agent_message_chunk")
      await acp.request("session/set_mode", { sessionId: acp.sessionId, modeId: "build" })
      lose(acp)

      expect(await rpcError(prompt)).toEqual(unavailable)
      await acp.server.stop()
      expect(await rpcError(acp.request("session/list", {}))).toEqual(unavailable)
      expect(acp.logs.map((log) => String(log.message)).toSorted()).toEqual(logs)
    },
  )
})

describe("acp terminal error metadata", () => {
  test("propagates provider status and retry delay into JSON-RPC error data", async () => {
    const rateLimit = { type: "provider.rate-limit", message: "Rate limit reached", status: 429, retryAfterMs: 60000 }
    const expected = {
      code: -32603,
      data: { service: "session", errorName: "provider.rate-limit", status: 429, retryAfterMs: 60000 },
    }

    await using execution = await startSession({
      onPrompt: ({ sessionID, id }) => [delivered(sessionID, id), failed(sessionID, rateLimit), succeeded(sessionID)],
    })
    expect(await rpcError(execution.prompt(execution.sessionId, "hello"))).toMatchObject(expected)

    await using step = await startSession({
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        durableEvent("session.step.failed", {
          sessionID,
          assistantMessageID: "msg_rate_limit",
          error: rateLimit,
        }),
        succeeded(sessionID),
      ],
    })
    expect(await rpcError(step.prompt(step.sessionId, "hello"))).toMatchObject(expected)

    await using plain = await startSession({
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        failed(sessionID, { type: "provider.rate-limit", message: "slow down" }),
        succeeded(sessionID),
      ],
    })
    const plainData = (await rpcError(plain.prompt(plain.sessionId, "hello"))).data
    expect(plainData).not.toHaveProperty("status")
    expect(plainData).not.toHaveProperty("retryAfterMs")
  })
})

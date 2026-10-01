import { describe, expect, test } from "bun:test"
import { RequestError } from "@agentclientprotocol/sdk"
import { Cause } from "effect"
import { ACPError } from "../../src/acp/error"
import { rpcError, startSession, startWire } from "./wire-fixture"

describe("acp errors", () => {
  test("maps validation failures to invalid params", () => {
    const cases: ACPError.Error[] = [
      new ACPError.SessionNotFoundError({ sessionId: "ses_missing" }),
      new ACPError.InvalidConfigOptionError({ configId: "temperature" }),
      new ACPError.InvalidModelError({ providerId: "anthropic", modelId: "claude-missing" }),
      new ACPError.InvalidEffortError({ effort: "extreme" }),
      new ACPError.InvalidModeError({ mode: "turbo" }),
      new ACPError.InvalidRequestError({ message: "Invalid session ID", field: "sessionID" }),
    ]

    expect(cases.map((error) => ACPError.toRequestError(error).code)).toEqual([
      -32602, -32602, -32602, -32602, -32602, -32602,
    ])
  })

  test("includes safe validation details", () => {
    expect(ACPError.toRequestError(new ACPError.SessionNotFoundError({ sessionId: "ses_123" }))).toMatchObject({
      code: -32602,
      data: { sessionId: "ses_123" },
    })
    expect(ACPError.toRequestError(new ACPError.InvalidModelError({ modelId: "gpt-missing" }))).toMatchObject({
      code: -32602,
      data: { modelId: "gpt-missing" },
    })
  })

  test("maps auth required to the SDK auth error", () => {
    const requestError = ACPError.toRequestError(new ACPError.AuthRequiredError())

    expect(requestError).toBeInstanceOf(RequestError)
    expect(requestError.code).toBe(-32000)
    expect(requestError.message).toBe("Authentication required: provider authentication required")
    expect(requestError.data).toEqual({})
  })

  test("maps service failures to safe internal errors", () => {
    const requestError = ACPError.toRequestError(
      new ACPError.ServiceFailureError({ service: "provider", safeMessage: "Provider request failed" }),
    )

    expect(requestError.code).toBe(-32603)
    expect(requestError.message).toBe("Internal error: Provider request failed")
    expect(requestError.data).toEqual({ service: "provider" })
  })

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
  test("maps unexpected server failures to the generic internal error", async () => {
    await using acp = await startWire({
      fetch: (request) =>
        request.method === "POST" && request.path === "/api/session" ? new Response(null, { status: 500 }) : undefined,
    })
    await acp.initialize()

    expect(await rpcError(acp.newSession())).toEqual({
      code: -32603,
      message: "Internal error: Internal service failure",
      data: { errorName: "ClientError" },
    })
    expect(acp.logs.map((log) => ({ message: log.message, cause: Cause.squash(log.cause) }))).toMatchObject([
      { message: ["ACP request failed"], cause: { name: "ClientError", reason: "UnexpectedStatus" } },
    ])
  })

  test("maps rejected prompt submissions to invalid params with the server's message", async () => {
    await using acp = await startSession({
      fetch: (request) =>
        request.method === "POST" && request.path.endsWith("/prompt")
          ? Response.json(
              { _tag: "InvalidRequestError", message: "File not readable: missing.png", field: "files" },
              { status: 400 },
            )
          : undefined,
    })

    expect(await rpcError(acp.prompt(acp.sessionId, "hello"))).toEqual({
      code: -32602,
      message: "Invalid params: File not readable: missing.png",
      data: { field: "files" },
    })
    expect(acp.logs).toEqual([])
  })

  test("reports an unavailable server once the server stops", async () => {
    await using acp = await startSession()
    await acp.server.stop()

    expect(await rpcError(acp.request("session/list", {}))).toEqual({
      code: -32603,
      message: "Internal error: OpenCode server is unavailable",
      data: { errorName: "ServerUnavailable" },
    })
    expect(acp.logs).toEqual([])
  })
})

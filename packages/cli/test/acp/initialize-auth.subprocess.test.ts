import type { AuthenticateResponse, InitializeResponse } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { createAcpFixture, expectOk, initialize } from "./subprocess"

describe("acp initialize/auth subprocess", () => {
  test("initialize responds with capabilities", async () => {
    await using fixture = await createAcpFixture()
    const initialized = await initialize(fixture.spawn())

    expect(initialized.protocolVersion).toBe(1)
    expect(initialized.agentCapabilities?.promptCapabilities?.embeddedContext).toBe(true)
    expect(initialized.agentCapabilities?.promptCapabilities?.image).toBe(true)
    expect(initialized.agentCapabilities?.mcpCapabilities?.http).toBe(true)
    expect(initialized.agentCapabilities?.mcpCapabilities?.sse).toBe(false)
    expect(initialized.agentCapabilities?.loadSession).toBe(true)
    expect(initialized.agentCapabilities?.sessionCapabilities?.close).toEqual({})
    expect(initialized.agentCapabilities?.sessionCapabilities?.fork).toEqual({})
    expect(initialized.agentCapabilities?.sessionCapabilities?.list).toEqual({})
    expect(initialized.agentCapabilities?.sessionCapabilities?.resume).toEqual({})
    expect(initialized.agentInfo?.name).toBe("OpenCode")
  }, 60_000)

  test("auth negotiation is explicit and safe", async () => {
    await using fixture = await createAcpFixture()
    const secret = "subprocess-auth-secret"
    const acp = fixture.spawn({ OPENCODE_AUTH_CONTENT: secret })
    const initialized = await initialize(acp)

    expect(initialized.authMethods?.[0]?.id).toBe("opencode-login")
    expect(initialized.authMethods?.[0]?._meta?.["terminal-auth"]).toBeDefined()
    expect(expectOk(await acp.request<AuthenticateResponse>("authenticate", { methodId: "opencode-login" }))).toEqual(
      {},
    )

    const rejected = await acp.request<AuthenticateResponse>("authenticate", { methodId: "missing-auth-method" })
    expect(rejected.error?.code).toBe(-32602)
    expect(JSON.stringify(rejected.error)).not.toContain(secret)
  }, 60_000)

  test("initialize without terminal-auth metadata keeps auth command implicit", async () => {
    await using fixture = await createAcpFixture()
    const initialized = expectOk(
      await fixture.spawn().request<InitializeResponse>("initialize", { protocolVersion: 1 }),
    )

    expect(initialized.authMethods?.[0]?.id).toBe("opencode-login")
    expect(initialized.authMethods?.[0]?._meta?.["terminal-auth"]).toBeUndefined()
  }, 60_000)
})

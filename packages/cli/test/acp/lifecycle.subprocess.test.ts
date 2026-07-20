import type {
  CloseSessionResponse,
  ListSessionsResponse,
  LoadSessionResponse,
  ResumeSessionResponse,
} from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { createAcpFixture, expectOk, initialize, newSession, selectConfigOption } from "./subprocess"

describe("acp lifecycle subprocess", () => {
  test("stdin EOF exits cleanly", async () => {
    await using fixture = await createAcpFixture()
    expect(await fixture.spawn().close()).toBe(0)
  }, 60_000)

  test("close capability and close request", async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn()
    const initialized = await initialize(acp)
    expect(initialized.agentCapabilities?.sessionCapabilities?.close).toEqual({})

    const session = await newSession(acp, fixture.home)
    expect(
      expectOk(await acp.request<CloseSessionResponse>("session/close", { sessionId: session.sessionId })),
    ).toEqual({})
  }, 60_000)

  test("new session succeeds on the first request", async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn()
    await initialize(acp)

    expect((await newSession(acp, fixture.home)).sessionId).toStartWith("ses_")
  }, 60_000)

  test("loadSession capability and load request return session config options", async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn()
    const initialized = await initialize(acp)
    expect(initialized.agentCapabilities?.loadSession).toBe(true)
    const session = await newSession(acp, fixture.home)
    const loaded = expectOk(
      await acp.request<LoadSessionResponse>("session/load", {
        cwd: fixture.home,
        sessionId: session.sessionId,
        mcpServers: [],
      }),
    )

    expect(selectConfigOption(loaded.configOptions, "model")?.category).toBe("model")
  }, 60_000)

  test("list request includes a live ACP-created session", async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)
    const listed = expectOk(await acp.request<ListSessionsResponse>("session/list", { cwd: fixture.home }))

    expect(listed.sessions.some((item) => item.sessionId === session.sessionId)).toBe(true)
  }, 60_000)

  test("resume capability advertisement", async () => {
    await using fixture = await createAcpFixture()
    const initialized = await initialize(fixture.spawn())

    expect(initialized.agentCapabilities?.sessionCapabilities?.resume).toEqual({})
  }, 60_000)

  test("resume request returns session config options", async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)
    const resumed = expectOk(
      await acp.request<ResumeSessionResponse>("session/resume", {
        cwd: fixture.home,
        sessionId: session.sessionId,
        mcpServers: [],
      }),
    )

    expect(selectConfigOption(resumed.configOptions, "model")?.category).toBe("model")
  }, 60_000)
})

import type {
  CloseSessionResponse,
  DeleteSessionResponse,
  ListSessionsResponse,
  LoadSessionResponse,
  ResumeSessionResponse,
} from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { selectConfigOption } from "./select-options"
import { createAcpFixture, expectOk, initialize, newSession } from "./subprocess"

describe("acp lifecycle subprocess", () => {
  test("stdin EOF exits cleanly", async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn()
    await initialize(acp)
    expect(await acp.close()).toBe(0)
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
    const mismatched = await acp.request<LoadSessionResponse>("session/load", {
      cwd: fixture.root,
      sessionId: session.sessionId,
      mcpServers: [],
    })
    expect(mismatched.error?.code).toBe(-32602)
  }, 60_000)

  test("list request includes a live ACP-created session", async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)
    const listed = expectOk(await acp.request<ListSessionsResponse>("session/list", { cwd: fixture.home }))

    expect(listed.sessions.some((item) => item.sessionId === session.sessionId)).toBe(true)
  }, 60_000)

  test("delete capability and delete request", async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn()
    const initialized = await initialize(acp)
    expect(initialized.agentCapabilities?.sessionCapabilities?.delete).toEqual({})
    const session = await newSession(acp, fixture.home)

    expect(
      expectOk(await acp.request<DeleteSessionResponse>("session/delete", { sessionId: session.sessionId })),
    ).toEqual({})
    const listed = expectOk(await acp.request<ListSessionsResponse>("session/list", { cwd: fixture.home }))
    expect(listed.sessions.some((item) => item.sessionId === session.sessionId)).toBe(false)
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

  // The private server is found with `pgrep`, which Windows lacks.
  const testOutsideWindows = process.platform === "win32" ? test.skip : test
  testOutsideWindows(
    "exits when the private server process dies (https://github.com/anomalyco/opencode/issues/51716)",
    async () => {
      await using fixture = await createAcpFixture()
      const acp = fixture.spawn()
      await initialize(acp)
      await newSession(acp, fixture.home)
      const servers = Bun.spawnSync(["pgrep", "-P", String(acp.pid)])
        .stdout.toString()
        .split("\n")
        .filter(Boolean)
        .map(Number)
      expect(servers).toHaveLength(1)

      process.kill(servers[0], "SIGKILL")

      const timeout = Promise.withResolvers<"running">()
      const timer = setTimeout(() => timeout.resolve("running"), 10_000)
      const exited = await Promise.race([acp.exited, timeout.promise]).finally(() => clearTimeout(timer))
      expect(exited).toBe(1)
      await acp[Symbol.asyncDispose]()
      expect(acp.stderr()).toContain("opencode acp: server exited unexpectedly (signal SIGKILL)")
    },
    60_000,
  )
})

import { describe, expect, test } from "bun:test"
import type { InitializeResponse } from "@agentclientprotocol/sdk"
import { createAcpFixture, expectOk, initialize } from "./subprocess"

describe("acp lifecycle subprocess", () => {
  test("stdin EOF exits cleanly", async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn()
    const initialized = expectOk(
      await acp.request<InitializeResponse>("initialize", {
        protocolVersion: 2,
        info: { name: "fallback-test", version: "1" },
      }),
    )
    expect(initialized.protocolVersion).toBe(1)
    expect(initialized.agentCapabilities?.loadSession).toBe(true)
    expect(await acp.close()).toBe(0)
  }, 60_000)

  // The private server is found with `pgrep`, which Windows lacks.
  const testOutsideWindows = process.platform === "win32" ? test.skip : test
  testOutsideWindows(
    "exits when the private server process dies (https://github.com/anomalyco/opencode/issues/51716)",
    async () => {
      await using fixture = await createAcpFixture()
      const acp = fixture.spawn()
      await initialize(acp)
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

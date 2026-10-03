import { describe, expect, test } from "bun:test"
import { ensureLoopbackNoProxy } from "../src/no-proxy"

describe("ensureLoopbackNoProxy", () => {
  test("adds loopback hosts when no proxy vars are set", () => {
    const env: NodeJS.ProcessEnv = {}
    ensureLoopbackNoProxy(env)
    expect(env.NO_PROXY).toBe("127.0.0.1,localhost,::1")
    expect(env.no_proxy).toBe("127.0.0.1,localhost,::1")
  })

  test("preserves existing entries without duplicating loopback hosts", () => {
    const env: NodeJS.ProcessEnv = {
      NO_PROXY: "example.com, localhost",
      no_proxy: "example.com",
    }
    ensureLoopbackNoProxy(env)
    expect(env.NO_PROXY).toBe("example.com,localhost,127.0.0.1,::1")
    expect(env.no_proxy).toBe("example.com,127.0.0.1,localhost,::1")
  })

  test("matches loopback hosts case-insensitively", () => {
    const env: NodeJS.ProcessEnv = { NO_PROXY: "LOCALHOST" }
    ensureLoopbackNoProxy(env)
    expect(env.NO_PROXY).toBe("LOCALHOST,127.0.0.1,::1")
  })
})

import { expect, test } from "bun:test"
import { Env } from "../src/env"

test("session environment omits server credentials", () => {
  const previousPassword = process.env.OPENCODE_PASSWORD
  const previousLegacyPassword = process.env.OPENCODE_SERVER_PASSWORD
  const previousValue = process.env.OPENCODE_SESSION_ENV_TEST
  process.env.OPENCODE_PASSWORD = "password"
  process.env.OPENCODE_SERVER_PASSWORD = "legacy"
  process.env.OPENCODE_SESSION_ENV_TEST = "included"

  const environment = Env.session()

  if (previousPassword === undefined) delete process.env.OPENCODE_PASSWORD
  else process.env.OPENCODE_PASSWORD = previousPassword
  if (previousLegacyPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
  else process.env.OPENCODE_SERVER_PASSWORD = previousLegacyPassword
  if (previousValue === undefined) delete process.env.OPENCODE_SESSION_ENV_TEST
  else process.env.OPENCODE_SESSION_ENV_TEST = previousValue

  expect(environment.OPENCODE_PASSWORD).toBeUndefined()
  expect(environment.OPENCODE_SERVER_PASSWORD).toBeUndefined()
  expect(environment.OPENCODE_SESSION_ENV_TEST).toBe("included")
})

test("loopback no-proxy fills both spellings in an empty environment", () => {
  const environment: Record<string, string | undefined> = {}

  Env.ensureLoopbackNoProxy(environment)

  expect(environment.NO_PROXY).toBe("127.0.0.1,localhost,::1")
  expect(environment.no_proxy).toBe("127.0.0.1,localhost,::1")
})

test("loopback no-proxy appends to existing hosts", () => {
  const environment: Record<string, string | undefined> = { NO_PROXY: "internal.example.com, .corp.example.com" }

  Env.ensureLoopbackNoProxy(environment)

  expect(environment.NO_PROXY).toBe("internal.example.com,.corp.example.com,127.0.0.1,localhost,::1")
  expect(environment.no_proxy).toBe("127.0.0.1,localhost,::1")
})

test("loopback no-proxy keeps already-present entries unduplicated", () => {
  const environment: Record<string, string | undefined> = { NO_PROXY: "LOCALHOST,127.0.0.1,::1", no_proxy: "::1" }

  Env.ensureLoopbackNoProxy(environment)

  expect(environment.NO_PROXY).toBe("LOCALHOST,127.0.0.1,::1")
  expect(environment.no_proxy).toBe("::1,127.0.0.1,localhost")
})

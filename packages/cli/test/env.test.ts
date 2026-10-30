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

test.each([
  {
    name: "populates both spellings when unset",
    input: {} as Record<string, string | undefined>,
    expected: "127.0.0.1,localhost,::1",
  },
  {
    name: "merges uppercase NO_PROXY into lowercase no_proxy so Bun and Node keep user hosts",
    input: { NO_PROXY: "corp.internal, .example.internal" },
    expected: "corp.internal,.example.internal,127.0.0.1,localhost,::1",
  },
  {
    name: "merges split spellings and deduplicates case-insensitively",
    input: { NO_PROXY: "a.internal, LOCALHOST", no_proxy: "b.internal, ::1, A.INTERNAL" },
    expected: "a.internal,LOCALHOST,b.internal,::1,127.0.0.1",
  },
  {
    name: "adds explicit 127.0.0.1 alongside Windows wildcard entries",
    input: { NO_PROXY: "172.31.*,127.*,localhost" },
    expected: "172.31.*,127.*,localhost,127.0.0.1,::1",
  },
  {
    name: "preserves universal wildcard intact for Node EnvHttpProxyAgent",
    input: { NO_PROXY: "corp.internal, *" },
    expected: "*",
  },
])("ensureLoopbackNoProxy $name", ({ input, expected }) => {
  const env = { ...input }
  Env.ensureLoopbackNoProxy(env)
  expect(env.NO_PROXY).toBe(expected)
  expect(env.no_proxy).toBe(expected)
})

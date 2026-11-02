import { expect, test } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"
import { isAllowedRequestHost } from "../src/host"

const options = {
  app: { version: "test-version" },
  database: { path: ":memory:" },
  config: { project: false },
  models: { fetch: false },
  fs: { filewatcher: false },
  hostname: "127.0.0.1",
} as const

test("loopback hosts stay reachable while a rebound domain does not", () => {
  expect(isAllowedRequestHost("127.0.0.1:4096", { hostname: "127.0.0.1" })).toBe(true)
  expect(isAllowedRequestHost("localhost:4096", { hostname: "127.0.0.1" })).toBe(true)
  expect(isAllowedRequestHost("[::1]:4096", { hostname: "127.0.0.1" })).toBe(true)
  expect(isAllowedRequestHost("attacker.example:4096", { hostname: "127.0.0.1" })).toBe(false)
  expect(isAllowedRequestHost(undefined, { hostname: "127.0.0.1" })).toBe(true)
})

test("a declared host stays reachable", () => {
  expect(isAllowedRequestHost("tunnel.example", { hostname: "127.0.0.1", hosts: ["https://tunnel.example"] })).toBe(
    true,
  )
  expect(isAllowedRequestHost("tunnel.example", { hostname: "127.0.0.1" })).toBe(false)
})

test("a server bound to the network is not pinned to loopback", () => {
  expect(isAllowedRequestHost("attacker.example:4096", { hostname: "0.0.0.0" })).toBe(true)
  expect(isAllowedRequestHost("attacker.example:4096", { hostname: "192.168.1.10" })).toBe(true)
})

it.live("rejects a request from an untrusted origin or a rebound host", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(options)
    const request = (headers: Record<string, string>) =>
      Effect.promise(() => handler(new Request("http://127.0.0.1:4096/api/model", { headers })))
    expect((yield* request({ origin: "http://attacker.example" })).status).toBe(403)
    expect((yield* request({ host: "attacker.example" })).status).toBe(403)
    expect((yield* request({ origin: "http://127.0.0.1:4096", host: "127.0.0.1:4096" })).status).not.toBe(403)
  }),
)

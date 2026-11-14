import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { Service, registrationFilename, fallback, type Endpoint } from "../src/promise/service"

test.each(["latest", "dev", "beta", "next"])("%s shares the release registration", (channel) => {
  expect(registrationFilename(channel)).toBe("service.json")
})

test.each([
  ["prod", "service-prod.json"],
  ["local", "service-local.json"],
  ["preview/a", "service-preview-a.json"],
])("%s has a named registration", (channel, file) => {
  expect(registrationFilename(channel)).toBe(file)
})

test("discovers and reuses an authenticated named owner without adopting the shared registration", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-service-channel-"))
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      Response.json(
        { version: "test", pid: process.pid },
        { status: request.headers.get("authorization") === "Basic " + btoa("opencode:secret") ? 200 : 401 },
      ),
  })
  try {
    const file = join(root, basename(fallback("prod")))
    const shared = join(root, basename(fallback()))
    await Bun.write(
      file,
      JSON.stringify({ url: server.url.origin, pid: process.pid, version: "test", password: "secret" }),
    )
    const endpoint = {
      url: server.url.origin,
      auth: { type: "basic", username: "opencode", password: "secret" },
    } satisfies Endpoint
    expect(await Service.discover({ file: shared })).toBeUndefined()
    expect(await Service.discover({ file, version: "test" })).toEqual(endpoint)
    expect(await Service.ensure({ file, version: "test", command: [] })).toEqual(endpoint)
    expect(await Bun.file(shared).exists()).toBe(false)
  } finally {
    await server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})

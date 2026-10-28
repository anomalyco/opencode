import { expect, test } from "bun:test"
import { Service } from "@opencode/client/service"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { serviceFile } from "./service-file"

test.each([
  { channel: "latest", override: undefined, name: "service.json" },
  { channel: "prod", override: undefined, name: "service-prod.json" },
  { channel: "local", override: undefined, name: "service.json" },
  { channel: "local", override: "local", name: "service-local.json" },
  { channel: "prod", override: "", name: "service.json" },
  { channel: "prod", override: "beta", name: "service.json" },
  { channel: "prod", override: "local", name: "service-local.json" },
  { channel: "latest", override: "prod", name: "service-prod.json" },
])("discovers the selected owner for $channel with override $override", async (input) => {
  await using fixture = await registrations()
  const owner = await fixture.start(input.name)
  await Promise.all(
    ["service.json", "service-prod.json", "service-local.json"].flatMap((name) =>
      name === input.name ? [] : [fixture.start(name)],
    ),
  )

  const endpoint = await Service.discover({
    file: serviceFile(path.join(fixture.root, "service.json"), input.channel, input.override),
    version: "test",
  })

  expect(endpoint?.url).toBe(owner.url)
  expect(endpoint?.auth).toEqual({ type: "basic", username: "opencode", password: input.name })
})

test("a prod selection cannot fall back to an unrelated shared owner", async () => {
  await using fixture = await registrations()
  await fixture.start("service.json")

  expect(
    await Service.discover({ file: serviceFile(path.join(fixture.root, "service.json"), "prod"), version: "test" }),
  ).toBeUndefined()
})

async function registrations() {
  const root = await mkdtemp(path.join(tmpdir(), "opencode service selection "))
  const servers: ReturnType<typeof Bun.serve>[] = []

  return {
    root,
    async start(name: string) {
      const server = Bun.serve({
        port: 0,
        fetch(request): Response {
          if (new URL(request.url).pathname !== "/api/info") return new Response(null, { status: 404 })

          if (request.headers.get("authorization") !== "Basic " + btoa("opencode:" + name))
            return new Response(null, { status: 401 })

          return Response.json({
            version: "test",
            pid: process.pid,
            hostname: "fixture",
            urls: [new URL(request.url).origin],
            paths: { tmp: root },
          })
        },
      })

      servers.push(server)
      const url = server.url.origin
      await writeFile(
        path.join(root, name),
        JSON.stringify({ id: name, version: "test", pid: process.pid, url, password: name }),
      )

      return { name, url }
    },
    async [Symbol.asyncDispose]() {
      servers.forEach((server) => server.stop(true))
      await rm(root, { recursive: true, force: true })
    },
  }
}

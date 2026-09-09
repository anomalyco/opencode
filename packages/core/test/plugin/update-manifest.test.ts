import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { PluginUpdate } from "../../src/plugin/update"

type Server = ReturnType<typeof Bun.serve>

let servers: Server[] = []

afterEach(() => {
  for (const s of servers) s.stop(true)
  servers = []
})

function serve(handler: (req: Request) => Response) {
  const server = Bun.serve({ port: 0, fetch: handler })
  servers.push(server)
  return `http://localhost:${server.port}`
}

const layer = Layer.mergeAll(FetchHttpClient.layer)

function run<A>(effect: Effect.Effect<A, never, HttpClient.HttpClient>) {
  return Effect.runPromise(effect.pipe(Effect.provide(layer)))
}

describe("latestVersion", () => {
  test("prefers the manifest version when the package is listed", async () => {
    const manifest = serve(() => Response.json({ "acme-plugin": "3.0.0" }))
    let registryHits = 0
    const registry = serve(() => {
      registryHits++
      return Response.json({ version: "2.0.0" })
    })

    // Point the registry lookup at the stub by overriding the npm registry.
    process.env.npm_config_registry = registry
    const version = await run(PluginUpdate.latestVersion("acme-plugin", manifest))
    delete process.env.npm_config_registry

    expect(version).toBe("3.0.0")
    expect(registryHits).toBe(0)
  })

  test("falls back to the registry when the manifest omits the package", async () => {
    const manifest = serve(() => Response.json({ "other-plugin": "1.0.0" }))
    const registry = serve(() => Response.json({ version: "2.0.0" }))

    process.env.npm_config_registry = registry
    const version = await run(PluginUpdate.latestVersion("acme-plugin", manifest))
    delete process.env.npm_config_registry

    expect(version).toBe("2.0.0")
  })

  test("falls back to the registry when the manifest is unreachable", async () => {
    const manifest = serve(() => new Response("boom", { status: 500 }))
    const registry = serve(() => Response.json({ version: "2.0.0" }))

    process.env.npm_config_registry = registry
    const version = await run(PluginUpdate.latestVersion("acme-plugin", manifest))
    delete process.env.npm_config_registry

    expect(version).toBe("2.0.0")
  })

  test("falls back to the registry when the manifest value is not a version", async () => {
    const manifest = serve(() => Response.json({ "acme-plugin": "not-a-version" }))
    const registry = serve(() => Response.json({ version: "2.0.0" }))

    process.env.npm_config_registry = registry
    const version = await run(PluginUpdate.latestVersion("acme-plugin", manifest))
    delete process.env.npm_config_registry

    expect(version).toBe("2.0.0")
  })

  test("uses the registry directly when no manifest is configured", async () => {
    const registry = serve(() => Response.json({ version: "2.0.0" }))

    process.env.npm_config_registry = registry
    const version = await run(PluginUpdate.latestVersion("acme-plugin"))
    delete process.env.npm_config_registry

    expect(version).toBe("2.0.0")
  })

  test("returns an empty string when every source fails", async () => {
    const manifest = serve(() => new Response("boom", { status: 500 }))
    const registry = serve(() => new Response("boom", { status: 500 }))

    process.env.npm_config_registry = registry
    const version = await run(PluginUpdate.latestVersion("acme-plugin", manifest))
    delete process.env.npm_config_registry

    expect(version).toBe("")
  })
})

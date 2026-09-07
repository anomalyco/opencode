import { expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

const lists = {
  agent: "/api/agent",
  command: "/api/command",
  integration: "/api/integration",
  mcp: "/api/mcp",
  mcpResource: "/api/mcp/resource",
  model: "/api/model",
  provider: "/api/provider",
  reference: "/api/reference",
  skill: "/api/skill",
  shell: "/api/shell",
  form: "/api/form/request",
}

it.live(
  "the location catalog matches the individual list endpoints",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-location-catalog-")))
      const server = yield* startServer(tmp.path)
      const read = (pathname: string) =>
        Effect.promise(async () => {
          const url = new URL(pathname, server.base)
          url.searchParams.set("location[directory]", tmp.path)
          const response = await fetch(url, { headers: server.headers })
          expect(response.status).toBe(200)
          return (await response.json()) as { location: unknown; data: unknown }
        })
      // Catalogs settle shortly after a location boots; compare once both views are populated and agree.
      const compare = Effect.gen(function* () {
        const catalog = yield* read("/api/location/catalog")
        const individual = yield* Effect.all(
          Object.fromEntries(Object.entries(lists).map(([field, pathname]) => [field, read(pathname)])),
          { concurrency: "unbounded" },
        )
        const expected = Object.fromEntries(Object.entries(individual).map(([field, part]) => [field, part.data]))
        const data = catalog.data as { agent: unknown[] }
        return {
          settled: data.agent.length > 0 && JSON.stringify(catalog.data) === JSON.stringify(expected),
          catalog,
          location: individual.agent.location,
          expected,
        }
      })
      const result = yield* compare.pipe(
        Effect.filterOrFail((result) => result.settled),
        Effect.retry(Schedule.spaced("100 millis")),
        Effect.timeout("10 seconds"),
        Effect.catch(() => compare),
      )
      expect(result.catalog.location).toEqual(result.location)
      expect(result.catalog.data).toEqual(result.expected)
    }),
  20_000,
)

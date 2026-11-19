import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { serveRoutes } from "./fixture/routes"

it.live("lists configured skills", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-skill-endpoint-")))
    yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "skills", "demo"), { recursive: true }))
    yield* Effect.promise(() =>
      fs.writeFile(
        path.join(tmp.path, "skills", "demo", "SKILL.md"),
        "---\nname: demo\ndescription: Demo skill\n---\nbody\n",
      ),
    )
    yield* Effect.promise(() =>
      fs.writeFile(path.join(tmp.path, "opencode.json"), JSON.stringify({ skills: [path.join(tmp.path, "skills")] })),
    )
    const server = yield* serveRoutes({
      database: { path: ":memory:" },
      config: { directory: tmp.path },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    yield* server.pluginsLoaded(tmp.path)
    const url = new URL("/api/skill", "http://opencode.local")
    url.searchParams.set("location[directory]", tmp.path)
    const response = yield* Effect.promise(() => server.fetch(url))

    expect(response.status).toBe(200)
    const body: unknown = yield* Effect.promise(() => response.json())
    if (!isRecord(body) || !Array.isArray(body["data"])) throw new Error("Expected a skill list response")
    expect(body["data"].some((skill) => isRecord(skill) && skill["name"] === "demo")).toBeTrue()
  }),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

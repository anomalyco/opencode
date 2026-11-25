import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { serveRoutes } from "./fixture/routes"

it.live("lists configured skills and reads their files", () =>
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

    const file = (id: string, name: string) => {
      const url = new URL(`/api/experimental/skill/${id}/file/${name}`, "http://opencode.local")
      url.searchParams.set("location[directory]", tmp.path)
      return Effect.promise(() => server.fetch(url))
    }
    const found = yield* file("demo", "SKILL.md")
    expect(found.status).toBe(200)
    expect(yield* Effect.promise(() => found.text())).toBe("body\n")
    const missingFile = yield* file("demo", "other.md")
    expect(missingFile.status).toBe(404)
    expect(yield* Effect.promise(() => missingFile.json())).toMatchObject({ _tag: "FileNotFoundError" })
    for (const unsafe of ["..%2Fsecret", "%ZZ"]) {
      const refused = yield* file("demo", unsafe)
      expect(refused.status).toBe(404)
      expect(yield* Effect.promise(() => refused.json())).toMatchObject({ _tag: "FileNotFoundError" })
    }
    const missingSkill = yield* file("missing", "SKILL.md")
    expect(missingSkill.status).toBe(404)
    expect(yield* Effect.promise(() => missingSkill.json())).toMatchObject({ _tag: "SkillNotFoundError" })
  }),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

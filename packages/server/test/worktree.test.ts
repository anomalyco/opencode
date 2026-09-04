import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live("lists, creates, and removes worktrees by project ID", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-worktree-endpoint-")))
    const project = path.join(tmp.path, "project")
    const destination = path.join(tmp.path, "worktrees")
    yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))
    yield* Effect.promise(() => $`git init`.cwd(project).quiet())
    yield* Effect.promise(() => $`git config user.email test@opencode.test`.cwd(project).quiet())
    yield* Effect.promise(() => $`git config user.name Test`.cwd(project).quiet())
    yield* Effect.promise(() => $`git commit --allow-empty -m root`.cwd(project).quiet())
    const server = yield* startServer(path.join(tmp.path, "config"))
    const location = new URL("/api/location", server.base)
    location.searchParams.set("location[directory]", project)
    const resolved = yield* Effect.promise(() =>
      fetch(location, { headers: server.headers }).then((response) => response.json()),
    )
    if (!isRecord(resolved) || !isRecord(resolved.project) || typeof resolved.project.id !== "string")
      throw new Error("Expected resolved project")
    const url = new URL(`/api/worktree/${resolved.project.id}`, server.base)

    const initial = yield* Effect.promise(() =>
      fetch(url, { headers: server.headers }).then((response) => response.json()),
    )
    expect(initial).toEqual([{ directory: project }])

    const created = yield* Effect.promise(() =>
      fetch(url, {
        method: "POST",
        headers: { ...server.headers, "content-type": "application/json" },
        body: JSON.stringify({ strategy: "git", directory: destination, name: "api" }),
      }).then((response) => response.json()),
    )
    expect(created).toEqual({ directory: path.join(destination, "api") })

    const listed = yield* Effect.promise(() =>
      fetch(url, { headers: server.headers }).then((response) => response.json()),
    )
    expect(listed).toContainEqual({ directory: path.join(destination, "api"), strategy: "git" })

    const removed = yield* Effect.promise(() =>
      fetch(url, {
        method: "DELETE",
        headers: { ...server.headers, "content-type": "application/json" },
        body: JSON.stringify({ directory: path.join(destination, "api"), force: false }),
      }),
    )
    expect(removed.status).toBe(204)
  }),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

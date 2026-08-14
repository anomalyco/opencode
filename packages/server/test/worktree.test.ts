import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { expect } from "bun:test"
import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

it.live("lists, creates, and removes worktrees by project ID", () =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir("opencode-worktree-endpoint-")),
    (tmp) =>
      Effect.gen(function* () {
        const project = path.join(tmp.path, "project")
        const destination = path.join(tmp.path, "worktrees")
        yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))
        yield* Effect.promise(() => $`git init`.cwd(project).quiet())
        yield* Effect.promise(() => $`git config user.email test@opencode.test`.cwd(project).quiet())
        yield* Effect.promise(() => $`git config user.name Test`.cwd(project).quiet())
        yield* Effect.promise(() => $`git commit --allow-empty -m root`.cwd(project).quiet())
        const server = yield* ServerProcess.start<never, never>({
          hostname: "127.0.0.1",
          port: 0,
          password: "secret",
          app: { version: "test-version" },
          database: { path: ":memory:" },
          config: { directory: path.join(tmp.path, "config") },
          fs: { filewatcher: false },
        })
        const base = HttpServer.formatAddress(server.address)
        const headers = { authorization: `Basic ${btoa("opencode:secret")}` }
        const location = new URL("/api/location", base)
        location.searchParams.set("location[directory]", project)
        const resolved = yield* Effect.promise(() => fetch(location, { headers }).then((response) => response.json()))
        if (!isRecord(resolved) || !isRecord(resolved.project) || typeof resolved.project.id !== "string")
          throw new Error("Expected resolved project")
        const url = new URL(`/api/experimental/project/${resolved.project.id}/worktree`, base)

        const initial = yield* Effect.promise(() => fetch(url, { headers }).then((response) => response.json()))
        expect(initial).toEqual([{ directory: project }])

        const created = yield* Effect.promise(() =>
          fetch(url, {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ strategy: "git", directory: destination, name: "api" }),
          }).then((response) => response.json()),
        )
        expect(created).toEqual({ directory: path.join(destination, "api") })

        const listed = yield* Effect.promise(() => fetch(url, { headers }).then((response) => response.json()))
        expect(listed).toContainEqual({ directory: path.join(destination, "api"), strategy: "git" })

        const removed = yield* Effect.promise(() =>
          fetch(url, {
            method: "DELETE",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ directory: path.join(destination, "api"), force: false }),
          }),
        )
        expect(removed.status).toBe(204)
      }),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

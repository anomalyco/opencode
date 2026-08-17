import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { expect } from "bun:test"
import { Project } from "@opencode-ai/schema/project"
import { Effect, Schema } from "effect"
import { HttpServer } from "effect/unstable/http"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

it.live("updates project metadata", () =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir("opencode-project-endpoint-")),
    (tmp) =>
      Effect.gen(function* () {
        const directory = path.join(tmp.path, "project")
        yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
        yield* Effect.promise(() => $`git init`.cwd(directory).quiet())
        yield* Effect.promise(() => $`git config user.email test@opencode.test`.cwd(directory).quiet())
        yield* Effect.promise(() => $`git config user.name Test`.cwd(directory).quiet())
        yield* Effect.promise(() => $`git commit --allow-empty -m root`.cwd(directory).quiet())
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
        location.searchParams.set("location[directory]", directory)
        const resolved: unknown = yield* Effect.promise(() =>
          fetch(location, { headers }).then((response) => response.json()),
        )
        if (!isRecord(resolved) || !isRecord(resolved.project) || typeof resolved.project.id !== "string")
          throw new Error("Expected resolved project")
        const projectID = resolved.project.id

        const response = yield* Effect.promise(() =>
          fetch(new URL(`/api/project/${projectID}`, base), {
            method: "PATCH",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({
              name: "Updated",
              icon: { color: "#123456" },
              commands: { start: "bun dev" },
            }),
          }),
        )
        const project = Schema.decodeUnknownSync(Project.Info)(yield* Effect.promise(() => response.json()))

        expect(response.status).toBe(200)
        expect(project).toMatchObject({
          id: projectID,
          name: "Updated",
          icon: { color: "#123456" },
          commands: { start: "bun dev" },
        })

        const listed = Schema.decodeUnknownSync(Schema.Array(Project.Info))(
          yield* Effect.promise(() =>
            fetch(new URL("/api/project", base), { headers }).then((result) => result.json()),
          ),
        )
        expect(listed).toContainEqual(project)

        const clearedResponse = yield* Effect.promise(() =>
          fetch(new URL(`/api/project/${projectID}`, base), {
            method: "PATCH",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ name: "", icon: { color: "" }, commands: { start: "" } }),
          }),
        )
        const cleared = Schema.decodeUnknownSync(Project.Info)(yield* Effect.promise(() => clearedResponse.json()))
        expect(clearedResponse.status).toBe(200)
        expect(cleared.name).toBeUndefined()
        expect(cleared.icon).toBeUndefined()
        expect(cleared.commands).toBeUndefined()
      }),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ),
)

it.live("returns a typed error for an unknown project", () =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir("opencode-project-endpoint-missing-")),
    (tmp) =>
      Effect.gen(function* () {
        const server = yield* ServerProcess.start<never, never>({
          hostname: "127.0.0.1",
          port: 0,
          password: "secret",
          app: { version: "test-version" },
          database: { path: ":memory:" },
          config: { directory: path.join(tmp.path, "config") },
          fs: { filewatcher: false },
        })
        const response = yield* Effect.promise(() =>
          fetch(new URL("/api/project/missing", HttpServer.formatAddress(server.address)), {
            method: "PATCH",
            headers: {
              authorization: `Basic ${btoa("opencode:secret")}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ name: "Missing" }),
          }),
        )

        expect(response.status).toBe(404)
        expect(yield* Effect.promise(() => response.json())).toEqual({
          _tag: "ProjectNotFoundError",
          projectID: "missing",
          message: "Project not found: missing",
        })
      }),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
